const { sendJson } = require("../_odsay");
const { getCollectorStatus } = require("../_mapping-index");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    return sendJson(res, 405, { error: "Method Not Allowed" });
  }

  try {
    const status = await getCollectorStatus();
    return sendJson(res, 200, status);
  } catch (error) {
    return sendJson(res, 500, { error: error.message || "인덱스 상태 조회에 실패했습니다" });
  }
};
