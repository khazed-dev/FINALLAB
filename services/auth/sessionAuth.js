const crypto = require("crypto");

function base64url(input) {
  return Buffer.from(input).toString("base64url");
}

function parseCookies(cookieHeader) {
  if (!cookieHeader) {
    return {};
  }

  return cookieHeader
    .split(";")
    .map((pair) => pair.trim())
    .filter(Boolean)
    .reduce((acc, pair) => {
      const eqIndex = pair.indexOf("=");
      if (eqIndex === -1) {
        return acc;
      }

      const key = pair.slice(0, eqIndex).trim();
      const value = pair.slice(eqIndex + 1).trim();
      acc[key] = decodeURIComponent(value);
      return acc;
    }, {});
}

function createSessionAuth({
  user,
  pass,
  sessionSecret,
  sessionTtlHours = 12,
  cookieSecure = false
}) {
  const sessionCookieName = "soc_session";
  const normalizedUser = user || "admin";
  const normalizedPass = pass || "change-me";
  const secret = sessionSecret || "change-me-now";

  function sign(payload) {
    return crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  }

  function createToken() {
    const payload = JSON.stringify({
      u: normalizedUser,
      exp: Date.now() + sessionTtlHours * 60 * 60 * 1000
    });
    const encoded = base64url(payload);
    return `${encoded}.${sign(encoded)}`;
  }

  function validateToken(token) {
    try {
      if (!token || !token.includes(".")) {
        return false;
      }

      const [encoded, signature] = token.split(".");
      const expected = sign(encoded);
      const provided = Buffer.from(signature);
      const known = Buffer.from(expected);

      if (provided.length !== known.length) {
        return false;
      }

      if (!crypto.timingSafeEqual(provided, known)) {
        return false;
      }

      const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
      return payload.exp > Date.now() && payload.u === normalizedUser;
    } catch (error) {
      return false;
    }
  }

  function isAuthenticated(req) {
    return validateToken(req.cookies?.[sessionCookieName]);
  }

  function setSessionCookie(res) {
    const cookieParts = [
      `${sessionCookieName}=${encodeURIComponent(createToken())}`,
      "Path=/",
      "HttpOnly",
      "SameSite=Strict",
      `Max-Age=${sessionTtlHours * 60 * 60}`
    ];

    if (cookieSecure) {
      cookieParts.push("Secure");
    }

    res.setHeader("Set-Cookie", cookieParts.join("; "));
  }

  function clearSessionCookie(res) {
    const cookieParts = [
      `${sessionCookieName}=`,
      "Path=/",
      "HttpOnly",
      "SameSite=Strict",
      "Max-Age=0"
    ];

    if (cookieSecure) {
      cookieParts.push("Secure");
    }

    res.setHeader("Set-Cookie", cookieParts.join("; "));
  }

  const cookieParserMiddleware = (req, res, next) => {
    req.cookies = parseCookies(req.headers.cookie);
    next();
  };

  const requirePageAuth = (req, res, next) => {
    if (isAuthenticated(req)) {
      return next();
    }
    return res.redirect("/login");
  };

  const requireApiAuth = (req, res, next) => {
    if (isAuthenticated(req)) {
      return next();
    }
    return res.status(401).json({
      ok: false,
      error: "Authentication required"
    });
  };

  const handleLogin = (req, res) => {
    const submittedUser = String(req.body.username || "");
    const submittedPass = String(req.body.password || "");

    if (submittedUser !== normalizedUser || submittedPass !== normalizedPass) {
      return res.status(401).json({
        ok: false,
        error: "Invalid username or password"
      });
    }

    setSessionCookie(res);
    return res.json({
      ok: true
    });
  };

  const handleLogout = (req, res) => {
    clearSessionCookie(res);
    return res.json({
      ok: true
    });
  };

  const socketAuth = (socket, next) => {
    try {
      const cookies = parseCookies(socket.handshake.headers.cookie);
      if (!validateToken(cookies[sessionCookieName])) {
        return next(new Error("Authentication required"));
      }
      return next();
    } catch (error) {
      return next(new Error("Authentication required"));
    }
  };

  return {
    cookieParserMiddleware,
    requirePageAuth,
    requireApiAuth,
    handleLogin,
    handleLogout,
    socketAuth,
    isAuthenticated
  };
}

module.exports = { createSessionAuth };
