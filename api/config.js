export default function handler(req, res) {
  res.json({
    apiKey: process.env.FIREBASE_API_KEY,
    authDomain: process.env.FIREBASE_AUTH_DOMAIN,
    projectId: process.env.FIREBASE_PROJECT_ID,
    appId: process.env.FIREBASE_APP_ID,
    priceStandard: process.env.STRIPE_PRICE_STANDARD,
    priceUnlimited: process.env.STRIPE_PRICE_UNLIMITED,
  });
}
