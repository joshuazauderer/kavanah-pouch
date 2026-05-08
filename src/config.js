require('dotenv').config();

const config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3000', 10),
  appBaseUrl: process.env.APP_BASE_URL || 'http://localhost:3000',

  db: {
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production'
      ? { rejectUnauthorized: false }
      : false,
  },

  session: {
    secret: process.env.SESSION_SECRET || 'dev-secret-replace-in-production',
    secure: process.env.NODE_ENV === 'production',
  },

  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY,
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
    prices: {
      one_pouch:  process.env.STRIPE_PRICE_1_POUCH,
      two_pack:   process.env.STRIPE_PRICE_2_PACK,
      three_pack: process.env.STRIPE_PRICE_3_PACK,
    },
    shippingRates: {
      flatUs: process.env.STRIPE_SHIPPING_RATE_FLAT_US,
      freeUs: process.env.STRIPE_SHIPPING_RATE_FREE_US,
    },
    pouchesPerPack: {
      one_pouch:  1,
      two_pack:   2,
      three_pack: 3,
    },
    // Cents amounts — kept in sync with Stripe price objects and frontend display
    subtotalCents: {
      one_pouch:  1499,
      two_pack:   2699,
      three_pack: 3999,
    },
    shippingCents: {
      one_pouch:  495,
      two_pack:   495,
      three_pack: 0,
    },
  },

  packaging: {
    weightOz:  parseFloat(process.env.DEFAULT_PACKAGE_WEIGHT_OZ  || '8'),
    lengthIn:  parseFloat(process.env.DEFAULT_PACKAGE_LENGTH_IN  || '13'),
    widthIn:   parseFloat(process.env.DEFAULT_PACKAGE_WIDTH_IN   || '10'),
    heightIn:  parseFloat(process.env.DEFAULT_PACKAGE_HEIGHT_IN  || '1'),
  },

  email: {
    ownerEmail: process.env.OWNER_NOTIFICATION_EMAIL,
    smtp: {
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
      from: process.env.SMTP_FROM || 'noreply@kavanahpouch.com',
    },
    enabled: !!(process.env.SMTP_HOST && process.env.SMTP_USER),
  },
};

module.exports = config;
