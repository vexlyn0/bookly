/**
 * Bookly — API бронирований (Supabase + RLS)
 */
window.BooklyBookings = (() => {
  const log = (...args) => {
    if (window.BooklyAuth?.log) {
      BooklyAuth.log("[Bookings]", ...args);
    } else {
      console.log("[BooklyBookings]", ...args);
    }
  };

  async function list(organizationId) {
    log("list:", organizationId);
    const supabase = await BooklyAuth.getClient();

    const { data, error } = await supabase
      .from("bookings")
      .select("*, services(name, duration_minutes, is_active), staff(name, is_active)")
      .eq("organization_id", organizationId)
      .order("booking_date", { ascending: true })
      .order("start_time", { ascending: true });

    if (error) {
      log("list error:", error.message);
      throw error;
    }

    return data || [];
  }

  /** Записи организации за период [fromDate, toDate] включительно (для календаря). */
  async function listRange(organizationId, fromDate, toDate) {
    const supabase = await BooklyAuth.getClient();

    const { data, error } = await supabase
      .from("bookings")
      .select("id, staff_id, service_id, booking_date, start_time, end_time, status, source, client_name, client_phone, client_comment, services(name)")
      .eq("organization_id", organizationId)
      .gte("booking_date", fromDate)
      .lte("booking_date", toDate)
      .order("start_time", { ascending: true });

    if (error) {
      log("listRange error:", error.message);
      throw error;
    }

    return data || [];
  }

  async function listForStaffDate(staffId, bookingDate) {
    const supabase = await BooklyAuth.getClient();

    const { data, error } = await supabase
      .from("bookings")
      .select("id, start_time, end_time, status")
      .eq("staff_id", staffId)
      .eq("booking_date", bookingDate);

    if (error) throw error;
    return data || [];
  }

  async function getStaffForService(organizationId, serviceId) {
    const supabase = await BooklyAuth.getClient();

    const { data, error } = await supabase
      .from("staff_services")
      .select("staff_id, staff(id, name, is_active)")
      .eq("organization_id", organizationId)
      .eq("service_id", serviceId);

    if (error) throw error;

    return (data || [])
      .map((row) => row.staff)
      .filter((member) => member && member.is_active)
      .sort((a, b) => a.name.localeCompare(b.name, "ru"));
  }

  async function create(organizationId, payload) {
    log("create:", payload.booking_date, payload.start_time);
    const supabase = await BooklyAuth.getClient();

    const startTime = BooklyBookingsSlots.formatTimeForInput(payload.start_time);

    const { data, error } = await supabase
      .from("bookings")
      .insert([
        {
          organization_id: organizationId,
          service_id: payload.service_id,
          staff_id: payload.staff_id,
          client_name: payload.client_name,
          client_phone: payload.client_phone,
          client_email: payload.client_email,
          client_comment: payload.client_comment,
          booking_date: payload.booking_date,
          start_time: startTime,
          end_time: startTime,
          status: payload.status || "confirmed",
          source: "manual",
        },
      ])
      .select("*, services(name, duration_minutes, is_active), staff(name, is_active)")
      .single();

    if (error) {
      log("create error:", error.message);
      throw error;
    }

    return data;
  }

  async function update(bookingId, payload, snapshot = null) {
    log("update:", bookingId);
    const supabase = await BooklyAuth.getClient();

    const startTime = BooklyBookingsSlots.formatTimeForInput(payload.start_time);
    const reschedule = isReschedule(snapshot, payload);

    const body = {
      client_name: payload.client_name,
      client_phone: payload.client_phone,
      client_email: payload.client_email,
      client_comment: payload.client_comment,
      status: payload.status,
    };

    if (reschedule) {
      Object.assign(body, {
        service_id: payload.service_id,
        staff_id: payload.staff_id,
        booking_date: payload.booking_date,
        start_time: startTime,
        end_time: startTime,
      });
    }

    const { data, error } = await supabase
      .from("bookings")
      .update(body)
      .eq("id", bookingId)
      .select("*, services(name, duration_minutes, is_active), staff(name, is_active)")
      .single();

    if (error) {
      log("update error:", error.message);
      throw error;
    }

    return data;
  }

  async function setStatus(bookingId, status) {
    const supabase = await BooklyAuth.getClient();

    const { data, error } = await supabase
      .from("bookings")
      .update({ status })
      .eq("id", bookingId)
      .select("*, services(name, duration_minutes, is_active), staff(name, is_active)")
      .single();

    if (error) throw error;
    return data;
  }

  async function remove(bookingId) {
    const supabase = await BooklyAuth.getClient();
    const { error } = await supabase.from("bookings").delete().eq("id", bookingId);
    if (error) throw error;
  }

  function computeStats(bookings) {
    const today = BooklyBookingsSlots.formatDateLocal(new Date());
    const nowMinutes = new Date().getHours() * 60 + new Date().getMinutes();

    let todayCount = 0;
    let upcomingCount = 0;

    for (const item of bookings || []) {
      if (item.status === "canceled" || item.status === "no_show") continue;

      if (item.booking_date === today) {
        todayCount += 1;
      }

      if (!BooklyBookingsConstants.UPCOMING_STATUSES.includes(item.status)) continue;

      if (item.booking_date > today) {
        upcomingCount += 1;
        continue;
      }

      if (item.booking_date === today) {
        const start = BooklyBookingsSlots.timeToMinutes(item.start_time);
        if (start !== null && start > nowMinutes) {
          upcomingCount += 1;
        }
      }
    }

    return { todayCount, upcomingCount };
  }

  /** Снимок записи для уведомления мастера (состояние «до изменения»). */
  function toNotifySnapshot(booking) {
    if (!booking) return null;
    return {
      staff_id: booking.staff_id,
      booking_date: booking.booking_date,
      start_time: booking.start_time,
      end_time: booking.end_time,
      status: booking.status,
      client_name: booking.client_name,
      client_phone: booking.client_phone,
      service_name: booking.services?.name || "",
    };
  }

  /**
   * Просит сервер уведомить мастера в Telegram. Не блокирует интерфейс и не бросает:
   * запись уже сохранена, уведомление — дополнительное действие.
   */
  async function notifyChange(event, bookingId, previous = null) {
    try {
      const supabase = await BooklyAuth.getClient();
      const { data } = await supabase.auth.getSession();
      const token = data?.session?.access_token;
      if (!token || !bookingId) return;

      const response = await fetch(booklyApiUrl("/api/bookings/notify"), {
        method: "POST",
        cache: "no-store",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ event, booking_id: bookingId, previous }),
      });
      if (!response.ok) log("notify failed:", response.status);
    } catch (error) {
      log("notify error:", error?.message);
    }
  }

  function isReschedule(snapshot, payload) {
    if (!snapshot) return true;

    const startTime = BooklyBookingsSlots.formatTimeForInput(payload.start_time);
    const snapshotStart = BooklyBookingsSlots.formatTimeForInput(snapshot.start_time);

    return (
      snapshot.service_id !== payload.service_id ||
      snapshot.staff_id !== payload.staff_id ||
      String(snapshot.booking_date) !== String(payload.booking_date) ||
      snapshotStart !== startTime
    );
  }

  return {
    list,
    listForStaffDate,
    getStaffForService,
    create,
    update,
    isReschedule,
    setStatus,
    listRange,
    remove,
    computeStats,
    toNotifySnapshot,
    notifyChange,
  };
})();
