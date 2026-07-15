/**
 * Bookly — API сотрудников (Supabase + RLS)
 */
window.BooklyStaff = (() => {
  const log = (...args) => {
    if (window.BooklyAuth?.log) {
      BooklyAuth.log("[Staff]", ...args);
    } else {
      console.log("[BooklyStaff]", ...args);
    }
  };

  function getServiceCount(item) {
    const row = item?.staff_services?.[0];
    return Number(row?.count) || 0;
  }

  async function list(organizationId) {
    log("list:", organizationId);
    const supabase = await BooklyAuth.getClient();

    const { data, error } = await supabase
      .from("staff")
      .select("*, staff_services(count)")
      .eq("organization_id", organizationId)
      .order("name", { ascending: true });

    if (error) {
      log("list error:", error.message);
      throw error;
    }

    return data || [];
  }

  async function getServiceIds(staffId) {
    log("getServiceIds:", staffId);
    const supabase = await BooklyAuth.getClient();

    const { data, error } = await supabase
      .from("staff_services")
      .select("service_id")
      .eq("staff_id", staffId);

    if (error) {
      log("getServiceIds error:", error.message);
      throw error;
    }

    return (data || []).map((row) => row.service_id);
  }

  async function setServiceLinks(organizationId, staffId, serviceIds) {
    log("setServiceLinks:", staffId, serviceIds.length);
    const supabase = await BooklyAuth.getClient();

    const { error: deleteError } = await supabase
      .from("staff_services")
      .delete()
      .eq("staff_id", staffId);

    if (deleteError) {
      log("setServiceLinks delete error:", deleteError.message);
      throw deleteError;
    }

    if (!serviceIds.length) return;

    const rows = serviceIds.map((serviceId) => ({
      staff_id: staffId,
      service_id: serviceId,
      organization_id: organizationId,
    }));

    const { error: insertError } = await supabase.from("staff_services").insert(rows);

    if (insertError) {
      log("setServiceLinks insert error:", insertError.message);
      throw insertError;
    }
  }

  async function create(organizationId, payload) {
    log("create:", organizationId, payload.name);
    const supabase = await BooklyAuth.getClient();

    const { data, error } = await supabase
      .from("staff")
      .insert([
        {
          organization_id: organizationId,
          name: payload.name,
          position: payload.position,
          phone: payload.phone,
          email: payload.email,
          description: payload.description,
          is_active: payload.is_active,
        },
      ])
      .select("*, staff_services(count)")
      .single();

    if (error) {
      log("create error:", error.message);
      throw error;
    }

    await setServiceLinks(organizationId, data.id, payload.service_ids || []);
    return listItemWithCount(data, payload.service_ids?.length || 0);
  }

  async function update(staffId, organizationId, payload) {
    log("update:", staffId);
    const supabase = await BooklyAuth.getClient();

    const { data, error } = await supabase
      .from("staff")
      .update({
        name: payload.name,
        position: payload.position,
        phone: payload.phone,
        email: payload.email,
        description: payload.description,
        is_active: payload.is_active,
      })
      .eq("id", staffId)
      .select("*, staff_services(count)")
      .single();

    if (error) {
      log("update error:", error.message);
      throw error;
    }

    await setServiceLinks(organizationId, staffId, payload.service_ids || []);
    return listItemWithCount(data, payload.service_ids?.length || 0);
  }

  async function remove(staffId) {
    log("remove:", staffId);
    const supabase = await BooklyAuth.getClient();

    const { error } = await supabase.from("staff").delete().eq("id", staffId);

    if (error) {
      log("remove error:", error.message);
      throw error;
    }
  }

  async function setActive(staffId, isActive) {
    log("setActive:", staffId, isActive);
    const supabase = await BooklyAuth.getClient();

    const { data, error } = await supabase
      .from("staff")
      .update({ is_active: isActive })
      .eq("id", staffId)
      .select("*, staff_services(count)")
      .single();

    if (error) {
      log("setActive error:", error.message);
      throw error;
    }

    return data;
  }

  function listItemWithCount(item, countOverride) {
    const count =
      typeof countOverride === "number" ? countOverride : getServiceCount(item);
    return {
      ...item,
      staff_services: [{ count }],
    };
  }

  function countActive(staffList) {
    return (staffList || []).filter((item) => item.is_active).length;
  }

  return {
    list,
    getServiceIds,
    create,
    update,
    remove,
    setActive,
    getServiceCount,
    countActive,
  };
})();
