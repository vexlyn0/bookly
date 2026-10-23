/**
 * Bookly — API компаний (Organizations)
 */
window.BooklyOrg = (() => {
  const log = (...args) => {
    if (window.BooklyAuth?.log) {
      BooklyAuth.log("[Org]", ...args);
    } else {
      console.log("[BooklyOrg]", ...args);
    }
  };

  /**
   * Получить компанию текущего пользователя
   */
  async function getMyOrganization() {
    log("getMyOrganization: start");

    const supabase = await BooklyAuth.getClient();
    const user = await BooklyAuth.getUser();

    if (!user) {
      log("getMyOrganization: no user");
      return null;
    }

    const { data, error } = await supabase
      .from("organization_members")
      .select(`
        role,
        organizations (
          id,
          name,
          business_type,
          timezone,
          slug,
          public_name,
          description,
          phone,
          address,
          public_booking_enabled,
          booking_confirmation_mode,
          client_manage_cutoff_hours,
          require_phone_verification,
          brand_color,
          created_at,
          updated_at
        )
      `)
      .eq("user_id", user.id)
      .maybeSingle();

    if (error) {
      log("getMyOrganization: error", error.message, error.code);
      throw error;
    }

    if (!data?.organizations) {
      log("getMyOrganization: not found");
      return null;
    }

    const org = {
      ...data.organizations,
      role: data.role,
    };

    log("getMyOrganization: ok", org.name);
    return org;
  }

  /**
   * Создать компанию через RPC (атомарно)
   */
  async function createOrganization({ name, businessType, timezone }) {
    log("createOrganization: start", { name, businessType, timezone });

    const supabase = await BooklyAuth.getClient();

    const { data, error } = await supabase.rpc("create_organization", {
      p_name: name,
      p_business_type: businessType,
      p_timezone: timezone || "Europe/Moscow",
    });

    if (error) {
      log("createOrganization: error", error.message, error.code);
      return { data: null, error };
    }

    const organization = {
      id: data.id,
      name: data.name,
      business_type: data.business_type,
      timezone: data.timezone,
      slug: data.slug,
      role: data.role,
      created_at: data.created_at,
    };

    log("createOrganization: ok", organization.name);
    return { data: organization, error: null };
  }

  /**
   * После авторизации: компания есть → /app, нет → /onboarding
   */
  async function redirectAfterAuth() {
    log("redirectAfterAuth: start");

    const target = BooklyAuth.getRedirectTarget();
    const targetPath = target.replace(window.BOOKLY_CONFIG?.assetBase || "", "") || "/";
    const needsOrganization = /^\/(app|onboarding)(\/|\?|$)/.test(targetPath);
    if (!needsOrganization && !/^\/(login|register)(\/|\?|$)/.test(targetPath)) {
      log("redirectAfterAuth: next →", target);
      window.location.replace(target);
      return;
    }

    try {
      const org = await getMyOrganization();
      if (org) {
        log("redirectAfterAuth: has org → /app");
        window.location.replace(booklyPath("/app"));
        return;
      }

      log("redirectAfterAuth: no org → /onboarding");
      window.location.replace(booklyPath("/onboarding"));
    } catch (error) {
      log("redirectAfterAuth: error", error.message);
      throw error;
    }
  }

  /**
   * Для защищённых страниц: требует компанию
   */
  async function requireOrganization() {
    log("requireOrganization: start");

    const org = await getMyOrganization();

    if (!org) {
      log("requireOrganization: redirect to onboarding");
      window.location.replace(booklyPath("/onboarding"));
      return null;
    }

    log("requireOrganization: ok", org.name);
    return org;
  }

  async function updatePublicBookingSettings(organizationId, payload) {
    log("updatePublicBookingSettings:", organizationId);
    const supabase = await BooklyAuth.getClient();

    const { data, error } = await supabase
      .from("organizations")
      .update({
        public_name: payload.public_name,
        slug: payload.slug,
        description: payload.description,
        phone: payload.phone,
        address: payload.address,
        public_booking_enabled: payload.public_booking_enabled,
        booking_confirmation_mode: payload.booking_confirmation_mode,
        client_manage_cutoff_hours: payload.client_manage_cutoff_hours,
        require_phone_verification: payload.require_phone_verification,
        brand_color: payload.brand_color,
      })
      .eq("id", organizationId)
      .select(`
        id,
        name,
        business_type,
        timezone,
        slug,
        public_name,
        description,
        phone,
        address,
        public_booking_enabled,
        booking_confirmation_mode,
        client_manage_cutoff_hours,
        require_phone_verification,
        brand_color,
        created_at,
        updated_at
      `)
      .single();

    if (error) {
      log("updatePublicBookingSettings: error", error.message, error.code);
      throw error;
    }

    return data;
  }

  return {
    getMyOrganization,
    createOrganization,
    redirectAfterAuth,
    requireOrganization,
    updatePublicBookingSettings,
  };
})();
