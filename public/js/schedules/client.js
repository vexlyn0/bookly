/**
 * Bookly — API рабочих графиков (Supabase + RLS)
 */
window.BooklySchedules = (() => {
  const log = (...args) => {
    if (window.BooklyAuth?.log) {
      BooklyAuth.log("[Schedules]", ...args);
    } else {
      console.log("[BooklySchedules]", ...args);
    }
  };

  function sortByDay(rows) {
    return [...(rows || [])].sort((a, b) => a.day_of_week - b.day_of_week);
  }

  function buildDefaultRows(organizationId, staffId) {
    return BooklyScheduleConstants.DEFAULT_SCHEDULE.map((day) => ({
      organization_id: organizationId,
      staff_id: staffId,
      day_of_week: day.day_of_week,
      is_working: day.is_working,
      start_time: day.start_time,
      end_time: day.end_time,
    }));
  }

  async function listForStaff(staffId) {
    log("listForStaff:", staffId);
    const supabase = await BooklyAuth.getClient();

    const { data, error } = await supabase
      .from("staff_schedules")
      .select("*")
      .eq("staff_id", staffId)
      .order("day_of_week", { ascending: true });

    if (error) {
      log("listForStaff error:", error.message);
      throw error;
    }

    return sortByDay(data || []);
  }

  /** Графики всех мастеров организации (для календаря). */
  async function listForOrganization(organizationId) {
    const supabase = await BooklyAuth.getClient();

    const { data, error } = await supabase
      .from("staff_schedules")
      .select("*")
      .eq("organization_id", organizationId);

    if (error) {
      log("listForOrganization error:", error.message);
      throw error;
    }

    return data || [];
  }

  async function ensureDefaults(organizationId, staffId) {
    const existing = await listForStaff(staffId);
    if (existing.length >= 7) {
      return existing;
    }

    log("ensureDefaults:", staffId);
    const supabase = await BooklyAuth.getClient();
    const rows = buildDefaultRows(organizationId, staffId);

    const { data, error } = await supabase
      .from("staff_schedules")
      .upsert(rows, { onConflict: "staff_id,day_of_week" })
      .select("*");

    if (error) {
      log("ensureDefaults error:", error.message);
      throw error;
    }

    return sortByDay(data || []);
  }

  async function save(organizationId, staffId, days) {
    log("save:", staffId);
    const supabase = await BooklyAuth.getClient();
    const existing = await listForStaff(staffId);
    const byDay = new Map(existing.map((row) => [row.day_of_week, row]));

    const results = [];

    for (const day of days) {
      const current = byDay.get(day.day_of_week);
      const payload = {
        organization_id: organizationId,
        staff_id: staffId,
        day_of_week: day.day_of_week,
        is_working: day.is_working,
        start_time: day.is_working ? day.start_time : null,
        end_time: day.is_working ? day.end_time : null,
        break_start: day.is_working && day.break_start ? day.break_start : null,
        break_end: day.is_working && day.break_end ? day.break_end : null,
      };

      if (current?.id) {
        const { data, error } = await supabase
          .from("staff_schedules")
          .update(payload)
          .eq("id", current.id)
          .select()
          .single();

        if (error) {
          log("save update error:", error.message);
          throw error;
        }

        results.push(data);
      } else {
        const { data, error } = await supabase
          .from("staff_schedules")
          .insert([payload])
          .select()
          .single();

        if (error) {
          log("save insert error:", error.message);
          throw error;
        }

        results.push(data);
      }
    }

    return sortByDay(results);
  }

  // ---------------------------------------------------------------------------
  // Исключения графика: выходные/отпуска (off), блоки (block), другие часы (hours)
  // ---------------------------------------------------------------------------

  /** Исключения, пересекающие период [from, to]; staffId — необязательно. */
  async function listTimeOff(organizationId, { staffId = "", from, to } = {}) {
    const supabase = await BooklyAuth.getClient();
    let query = supabase
      .from("staff_time_off")
      .select("*")
      .eq("organization_id", organizationId)
      .order("date_from", { ascending: true })
      .order("start_time", { ascending: true });
    if (staffId) query = query.eq("staff_id", staffId);
    if (to) query = query.lte("date_from", to);
    if (from) query = query.gte("date_to", from);

    const { data, error } = await query;
    if (error) {
      log("listTimeOff error:", error.message);
      throw error;
    }
    return data || [];
  }

  async function addTimeOff(organizationId, payload) {
    const supabase = await BooklyAuth.getClient();
    const kind = payload.kind;
    const row = {
      organization_id: organizationId,
      staff_id: payload.staff_id,
      kind,
      date_from: payload.date_from,
      date_to: kind === "off" ? payload.date_to || payload.date_from : payload.date_from,
      start_time: kind === "off" ? null : payload.start_time,
      end_time: kind === "off" ? null : payload.end_time,
      note: String(payload.note || "").trim().slice(0, 200) || null,
    };
    const { data, error } = await supabase.from("staff_time_off").insert([row]).select().single();
    if (error) {
      log("addTimeOff error:", error.message);
      throw error;
    }
    return data;
  }

  async function removeTimeOff(id) {
    const supabase = await BooklyAuth.getClient();
    const { error } = await supabase.from("staff_time_off").delete().eq("id", id);
    if (error) throw error;
  }

  return {
    listForStaff,
    listForOrganization,
    ensureDefaults,
    save,
    listTimeOff,
    addTimeOff,
    removeTimeOff,
  };
})();
