const { sendJson } = require("./_odsay");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    return sendJson(res, 405, { error: "Method Not Allowed" });
  }

  sendJson(res, 200, {
    kakaoMapKey: process.env.VITE_KAKAO_MAP_KEY
      || process.env.KAKAO_MAP_JS_KEY
      || process.env.KAKAO_MAP_KEY
      || ""
  });
};
