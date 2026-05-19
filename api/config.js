const { sendJson } = require("./_odsay");
const { guardPublicApi } = require("./_public-api-guard");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    return sendJson(res, 405, { error: "Method Not Allowed" });
  }
  if (guardPublicApi(req, res, sendJson, { scope: "config", limit: 120 })) return;

  sendJson(res, 200, {
    kakaoMapKey: process.env.VITE_KAKAO_MAP_KEY
      || process.env.KAKAO_MAP_JS_KEY
      || process.env.KAKAO_MAP_KEY
      || ""
  });
};
