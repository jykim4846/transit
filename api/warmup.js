const { sendJson } = require("./_odsay");
const { downloadRouteWorkbookRows } = require("./_seoul-bus");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    return sendJson(res, 405, { error: "Method Not Allowed" });
  }

  try {
    const rows = await downloadRouteWorkbookRows();
    return sendJson(res, 200, {
      warmed: true,
      workbookRows: rows.length,
      warmedAt: new Date().toISOString()
    });
  } catch (error) {
    return sendJson(res, 500, {
      warmed: false,
      error: error.message || "워크북 warmup에 실패했습니다"
    });
  }
};
