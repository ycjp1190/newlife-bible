// 웹 푸시용 VAPID 키 한 쌍을 만든다. (최초 1회)
// 공개키 → wrangler.toml 의 VAPID_PUBLIC_KEY
// 비밀키 → `npx wrangler secret put VAPID_PRIVATE_KEY` 로 입력 (파일에 저장하지 말 것)
import { generateVapidKeys } from "../worker/push.js";

const { publicKey, privateKey } = await generateVapidKeys();
console.log("VAPID_PUBLIC_KEY =", publicKey);
console.log("VAPID_PRIVATE_KEY =", privateKey);
