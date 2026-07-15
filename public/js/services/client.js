/**
 * Bookly — API услуг (Supabase + RLS)
 */
window.BooklyServices = (() => {
  const log = (...args) => {
    if (window.BooklyAuth?.log) {
      BooklyAuth.log("[Services]", ...args);
    } else {
      console.log("[BooklyServices]", ...args);
    }
  };

  async function list(organizationId) {
    log("list:", organizationId);
    const supabase = await BooklyAuth.getClient();

    const { data, error } = await supabase
      .from("services")
      .select("*")
      .eq("organization_id", organizationId)
      .order("name", { ascending: true });

    if (error) {
      log("list error:", error.message);
      throw error;
    }

    return data || [];
  }

  async function create(organizationId, payload) {
    log("create:", organizationId, payload.name);
    const supabase = await BooklyAuth.getClient();

    const { data, error } = await supabase
      .from("services")
      .insert([
        {
          organization_id: organizationId,
          name: payload.name,
          description: payload.description,
          price: payload.price,
          duration_minutes: payload.duration_minutes,
          category: payload.category,
          is_active: payload.is_active,
        },
      ])
      .select()
      .single();

    if (error) {
      log("create error:", error.message);
      throw error;
    }

    return data;
  }

  async function update(serviceId, payload) {
    log("update:", serviceId);
    const supabase = await BooklyAuth.getClient();

    const { data, error } = await supabase
      .from("services")
      .update({
        name: payload.name,
        description: payload.description,
        price: payload.price,
        duration_minutes: payload.duration_minutes,
        category: payload.category,
        is_active: payload.is_active,
      })
      .eq("id", serviceId)
      .select()
      .single();

    if (error) {
      log("update error:", error.message);
      throw error;
    }

    return data;
  }

  async function remove(serviceId) {
    log("remove:", serviceId);
    const supabase = await BooklyAuth.getClient();

    const { error } = await supabase.from("services").delete().eq("id", serviceId);

    if (error) {
      log("remove error:", error.message);
      throw error;
    }
  }

  async function setActive(serviceId, isActive) {
    log("setActive:", serviceId, isActive);
    const supabase = await BooklyAuth.getClient();

    const { data, error } = await supabase
      .from("services")
      .update({ is_active: isActive })
      .eq("id", serviceId)
      .select()
      .single();

    if (error) {
      log("setActive error:", error.message);
      throw error;
    }

    return data;
  }

  function countActive(services) {
    return (services || []).filter((item) => item.is_active).length;
  }

  function formatPrice(price) {
    const value = Number(price) || 0;
    return `${value.toLocaleString("ru-RU")} ₸`;
  }

  function formatDuration(minutes) {
    const value = Number(minutes) || 0;
    if (value < 60) return `${value} мин`;
    const hours = Math.floor(value / 60);
    const mins = value % 60;
    return mins > 0 ? `${hours} ч ${mins} мин` : `${hours} ч`;
  }

  return {
    list,
    create,
    update,
    remove,
    setActive,
    countActive,
    formatPrice,
    formatDuration,
  };
})();
