/**
 * Bookly — Supabase Auth клиент
 */
window.BooklyAuth = (() => {
  let client = null;
  let initPromise = null;
  let authListener = null;

  const LOGIN_PATH = "/login";
  const APP_PATH = "/app";
  const DEBUG = true;

  const log = (...args) => {
    if (DEBUG) console.log("[BooklyAuth]", ...args);
  };

  const getClient = async () => {
    if (client) return client;
    if (initPromise) return initPromise;

    log("getClient: initializing");

    initPromise = (async () => {
      const response = await fetch(booklyApiUrl("/api/public-config"));
      let config = {};

      try {
        config = await response.json();
      } catch {
        throw Object.assign(
          new Error("Не удалось загрузить конфигурацию авторизации."),
          { code: "CONFIG_PARSE_ERROR", status: response.status }
        );
      }

      if (!response.ok || !config.supabaseUrl || !config.supabaseAnonKey) {
        throw Object.assign(
          new Error(
            config.message ||
              "Сервис авторизации временно недоступен. Попробуйте позже."
          ),
          {
            code: config.code || "SUPABASE_NOT_CONFIGURED",
            status: response.status || 503,
          }
        );
      }

      if (!window.supabase?.createClient) {
        throw Object.assign(new Error("Не удалось загрузить модуль авторизации."), {
          code: "SDK_MISSING",
        });
      }

      client = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          storageKey: "bookly-auth",
        },
      });

      log("getClient: ready");
      return client;
    })();

    try {
      return await initPromise;
    } catch (error) {
      initPromise = null;
      throw error;
    }
  };

  /**
   * Ожидает INITIAL_SESSION — рекомендуемый способ Supabase v2.
   * Не вызывает getSession() параллельно, чтобы избежать deadlock.
   */
  const waitForSession = ({ timeoutMs = 10000 } = {}) => {
    log("waitForSession: start");

    return new Promise((resolve) => {
      let settled = false;

      const finish = (session, reason) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        log("waitForSession: done", reason, {
          hasSession: !!session,
          email: session?.user?.email || null,
        });
        resolve(session);
      };

      const timer = setTimeout(() => {
        log("waitForSession: timeout");
        finish(null, "timeout");
      }, timeoutMs);

      getClient()
        .then((supabase) => {
          const { data } = supabase.auth.onAuthStateChange((event, session) => {
            log("onAuthStateChange:", event, {
              hasSession: !!session,
              email: session?.user?.email || null,
            });

            if (event === "INITIAL_SESSION") {
              data.subscription.unsubscribe();
              finish(session, "INITIAL_SESSION");
            }
          });
        })
        .catch((error) => {
          log("waitForSession: error", error.message);
          finish(null, "error");
        });
    });
  };

  const getSession = async () => {
    log("getSession: start");
    const supabase = await getClient();
    const { data, error } = await supabase.auth.getSession();

    if (error) {
      log("getSession: error", error.message);
      return null;
    }

    log("getSession: result", {
      hasSession: !!data.session,
      email: data.session?.user?.email || null,
    });

    return data.session;
  };

  const getUser = async () => {
    const supabase = await getClient();
    const { data, error } = await supabase.auth.getUser();

    if (error) {
      log("getUser: error", error.message);
      return null;
    }

    log("getUser: result", { email: data.user?.email || null });
    return data.user;
  };

  const getRedirectTarget = () => {
    const params = new URLSearchParams(window.location.search);
    const next = params.get("next");

    if (next && next.startsWith("/") && !next.startsWith("//")) {
      return next;
    }

    return booklyPath(APP_PATH);
  };

  const redirectToLogin = (nextPath) => {
    const next = nextPath || window.location.pathname + window.location.search;
    const loginUrl = new URL(booklyPath(LOGIN_PATH), window.location.origin);

    if (next && next !== booklyPath(LOGIN_PATH) && next !== booklyPath("/register")) {
      loginUrl.searchParams.set("next", next);
    }

    log("redirectToLogin:", loginUrl.pathname + loginUrl.search);
    window.location.replace(loginUrl.pathname + loginUrl.search);
  };

  const redirectToApp = () => {
    const target = getRedirectTarget();
    log("redirectToApp:", target);
    window.location.replace(target);
  };

  const requireSession = async () => {
    log("requireSession: start");

    try {
      const session = await waitForSession();

      if (!session) {
        log("requireSession: no session, redirecting to login");
        redirectToLogin(booklyPath(APP_PATH));
        return null;
      }

      log("requireSession: ok", session.user?.email);
      return session;
    } catch (error) {
      log("requireSession: exception", error.message);
      redirectToLogin(booklyPath(APP_PATH));
      return null;
    }
  };

  const onAuthStateChange = (callback) => {
    if (authListener) {
      authListener.unsubscribe();
      authListener = null;
    }

    getClient()
      .then((supabase) => {
        const { data } = supabase.auth.onAuthStateChange((event, session) => {
          if (event === "INITIAL_SESSION") return;
          callback(event, session);
        });
        authListener = data.subscription;
      })
      .catch((error) => {
        log("onAuthStateChange: setup error", error.message);
      });

    return () => {
      authListener?.unsubscribe();
      authListener = null;
    };
  };

  const authFetch = async (url, options = {}) => {
    const session = await getSession();

    if (!session) {
      redirectToLogin();
      throw new Error("Требуется авторизация.");
    }

    const headers = new Headers(options.headers || {});
    headers.set("Authorization", `Bearer ${session.access_token}`);

    if (options.body && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    const response = await fetch(booklyApiUrl(url), { ...options, headers });

    if (response.status === 401) {
      await signOut({ redirect: true });
      throw new Error("Сессия истекла.");
    }

    return response;
  };

  const signIn = async (email, password) => {
    log("signIn: start", email);
    const supabase = await getClient();
    const result = await supabase.auth.signInWithPassword({ email, password });

    log("signIn: result", {
      hasSession: !!result.data?.session,
      error: result.error?.message || null,
    });

    return result;
  };

  const signUp = async (email, password, metadata = {}) => {
    log("signUp: start", email);
    const supabase = await getClient();
    const result = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: metadata,
        emailRedirectTo: `${window.location.origin}${booklyPath(APP_PATH)}`,
      },
    });

    log("signUp: result", {
      hasUser: !!result.data?.user,
      hasSession: !!result.data?.session,
      error: result.error?.message || null,
      errorCode: result.error?.code || null,
    });

    return result;
  };

  /**
   * Регистрация с гарантированным входом:
   * 1) signUp → если есть session, готово
   * 2) иначе signInWithPassword
   */
  const signUpAndEnter = async (email, password, metadata = {}) => {
    const signUpResult = await signUp(email, password, metadata);

    if (signUpResult.data?.session) {
      log("signUpAndEnter: session from signUp");
      return { data: signUpResult.data, error: signUpResult.error, step: "signUp" };
    }

    if (signUpResult.error && !signUpResult.data?.user) {
      return { data: signUpResult.data, error: signUpResult.error, step: "signUp" };
    }

    log("signUpAndEnter: no session after signUp, trying signIn");
    const signInResult = await signIn(email, password);

    return {
      data: signInResult.data,
      error: signInResult.error || signUpResult.error,
      step: "signIn",
    };
  };

  const signOut = async ({ redirect = true } = {}) => {
    log("signOut: start");

    try {
      const supabase = await getClient();
      await supabase.auth.signOut();
    } catch (error) {
      log("signOut: error", error.message);
    } finally {
      authListener?.unsubscribe();
      authListener = null;
      client = null;
      initPromise = null;

      if (redirect) {
        window.location.replace(booklyPath(LOGIN_PATH));
      }
    }
  };

  const formatUserName = (user) => {
    if (!user) return "Пользователь";

    const metadata = user.user_metadata || {};
    return (
      metadata.full_name ||
      [metadata.first_name, metadata.last_name].filter(Boolean).join(" ") ||
      user.email?.split("@")[0] ||
      "Пользователь"
    );
  };

  return {
    getClient,
    waitForSession,
    getSession,
    getUser,
    getRedirectTarget,
    redirectToLogin,
    redirectToApp,
    requireSession,
    onAuthStateChange,
    authFetch,
    signIn,
    signUp,
    signUpAndEnter,
    signOut,
    formatUserName,
    log,
  };
})();
