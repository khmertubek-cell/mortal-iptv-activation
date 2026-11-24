interface Env {
  DB: D1Database;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const headers = {
      "Content-Type": "application/json",
      "Cache-Control": "no-store"
    };

    const url = new URL(request.url);

    if (request.method !== "POST" ||
        url.pathname !== "/activate") {
      return Response.json(
        { success: false, message: "Not found" },
        { status: 404, headers }
      );
    }

    try {
      const body = await request.json() as {
        code?: string;
        deviceId?: string;
      };

      const code = body.code?.trim();
      const deviceId = body.deviceId?.trim();

      if (!code || !deviceId ||
          code.length > 100 || deviceId.length > 150) {
        return Response.json(
          { success: false, message: "Invalid request" },
          { status: 400, headers }
        );
      }

      const record = await env.DB.prepare(`
        SELECT code, status, device_id, expires_at
        FROM activation_codes
        WHERE code = ?
      `).bind(code).first<{
        code: string;
        status: string;
        device_id: string | null;
        expires_at: string;
      }>();

      if (!record) {
        return Response.json(
          { success: false, message: "Invalid activation code" },
          { status: 200, headers }
        );
      }

      if (record.status !== "active") {
        return Response.json(
          { success: false, message: "Code is disabled" },
          { status: 200, headers }
        );
      }

      if (Date.parse(record.expires_at) <= Date.now()) {
        return Response.json(
          { success: false, message: "Activation code expired" },
          { status: 200, headers }
        );
      }

      if (record.device_id &&
          record.device_id !== deviceId) {
        return Response.json(
          { success: false, message: "Code already used on another device" },
          { status: 200, headers }
        );
      }

      const result = await env.DB.prepare(`
        UPDATE activation_codes
        SET device_id = ?
        WHERE code = ?
          AND status = 'active'
          AND (device_id IS NULL OR device_id = ?)
          AND expires_at > ?
      `).bind(
        deviceId,
        code,
        deviceId,
        new Date().toISOString()
      ).run();

      if (result.meta.changes !== 1) {
        return Response.json(
          { success: false, message: "Activation could not be completed" },
          { status: 200, headers }
        );
      }

      return Response.json({
        success: true,
        message: "Activation successful",
        expiresAt: record.expires_at
      }, { headers });

    } catch {
      return Response.json(
        { success: false, message: "Server error" },
        { status: 500, headers }
      );
    }
  }
};
