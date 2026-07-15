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

  return {
    listForStaff,
    ensureDefaults,
    save,
  };
})();
