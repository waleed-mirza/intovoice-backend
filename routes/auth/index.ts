import express from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import verifyToken from "../../middlewares/verifyToken";
import { loginValidation, signupValidation } from "../../middlewares/formValidation";
import { authLimiter } from "../../middlewares/rateLimiter";

const router = express.Router();

const sanitizeUser = (user: any) => {
  const sanitized = { ...user };
  delete sanitized.password;
  return sanitized;
};

const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: (process.env.NODE_ENV === "production" ? "none" : "lax") as "none" | "lax",
  maxAge: 1000 * 60 * 60 * 24 * 7,
  path: "/",
};

router.post("/signup", authLimiter, signupValidation, async (req: any, res) => {
  try {
    const { name, email, password } = req.body;
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const existing = await req.prisma.user.findUnique({ where: { email } });
    if (existing) {
      return res.status(409).json({ message: "Email already in use" });
    }

    await req.prisma.user.create({
      data: { email, password: hashedPassword, name },
    });

    res.status(200).json({ message: "User created" });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

router.post("/login", loginValidation, async (req: any, res: any) => {
  try {
    const { email, password } = req.body;
    const user = await req.prisma.user.findUnique({ where: { email } });

    if (!user?.password || user.isDeleted) {
      return res.status(401).json({ message: "Invalid Credentials" });
    }

    const passwordMatched = await bcrypt.compare(password, user.password);
    if (!passwordMatched) {
      return res.status(401).json({ message: "Invalid Credentials" });
    }

    const token = jwt.sign({ id: user.id }, process.env.SECRET_KEY as string, {
      expiresIn: "7d",
    });

    res.cookie("token", token, cookieOptions);
    res.cookie("auth_token", token, { ...cookieOptions, httpOnly: false });

    res.status(200).json({
      message: "Login successful",
      user: sanitizeUser(user),
      token,
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

router.get("/verify", verifyToken, async (req: any, res: any) => {
  try {
    const user = await req.prisma.user.findUnique({ where: { id: req.userId } });
    if (!user || user.isDeleted) {
      return res.status(401).json({ message: "Invalid Token" });
    }
    res.status(200).json({ user: sanitizeUser(user) });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

router.post("/logout", (_req, res) => {
  const clearOptions = { ...cookieOptions, maxAge: 0 };
  res.cookie("token", "", clearOptions);
  res.cookie("auth_token", "", { ...clearOptions, httpOnly: false });
  res.status(200).json({ message: "Logout successful" });
});

export default router;
