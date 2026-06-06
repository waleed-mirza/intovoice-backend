import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import prisma from "./prismaClient";

const app = express();
const IS_PRODUCTION = process.env.NODE_ENV === "production";
const ALLOW_NO_ORIGIN = process.env.ALLOW_NO_ORIGIN === "true";

const allowedOrigins = [
  process.env.FRONTEND_URL,
  "http://localhost:3000",
].filter(Boolean) as string[];

app.use(
  cors({
    origin(origin, callback) {
      if (IS_PRODUCTION && !origin && !ALLOW_NO_ORIGIN) {
        return callback(new Error("Origin required in production"));
      }
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      console.warn(`Blocked CORS request from: ${origin}`);
      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
  })
);

app.use(express.json({ limit: IS_PRODUCTION ? "10mb" : "50mb" }));
app.use(
  express.urlencoded({ extended: true, limit: IS_PRODUCTION ? "10mb" : "50mb" })
);
app.use(cookieParser());

app.use((req: any, _res, next) => {
  req.prisma = prisma;
  next();
});

app.use((err: any, _req: any, res: any, _next: any) => {
  console.error("Error:", err.message);
  res.status(err.status || 500).json({
    success: false,
    message: IS_PRODUCTION ? err.message || "Internal server error" : err.message,
  });
});

export default app;
