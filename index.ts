import dotenv from "dotenv";
import helmet from "helmet";
import compression from "compression";
import authRouter from "./routes/auth";
import voiceRouter from "./routes/voice";
import notificationRouter from "./routes/notification";
import reportRouter from "./routes/report";
import verifyToken from "./middlewares/verifyToken";
import app from "./middlewares/appServer";
import prisma from "./middlewares/prismaClient";
import { cleanupStaleLiveStreams } from "./services/cleanupStaleLiveStreams";

dotenv.config();

const PORT = process.env.PORT || 5000;
const IS_PRODUCTION = process.env.NODE_ENV === "production";

if (IS_PRODUCTION) {
  const required = ["DATABASE_URL", "SECRET_KEY"];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    console.error(`Missing required env vars: ${missing.join(", ")}`);
    process.exit(1);
  }
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
    })
  );
}

app.use(
  compression({
    filter: (req, res) => {
      if (req.headers["x-no-compression"]) return false;
      return compression.filter(req, res);
    },
    level: 6,
  })
);

app.use("/auth", authRouter);
app.use("/voice", voiceRouter);
app.use("/notification", verifyToken, notificationRouter);
app.use("/report", reportRouter);

app.get("/", (_req, res) => {
  res.json({
    status: "ok",
    message: "Into Voice API",
    version: "1.0.0",
    timestamp: new Date().toISOString(),
  });
});

app.get("/health", (_req, res) => {
  res.json({ status: "healthy", timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`Into Voice backend running on port ${PORT}`);

  cleanupStaleLiveStreams(prisma)
    .then((count) => {
      if (count > 0) {
        console.log(`Cleaned up ${count} stale live stream(s)`);
      }
    })
    .catch((error) => {
      console.error("Startup stale live cleanup failed:", error.message);
    });
});
