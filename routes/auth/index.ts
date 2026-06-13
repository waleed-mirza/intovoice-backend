import express from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import verifyToken from "../../middlewares/verifyToken";
import {
  loginValidation,
  signupValidation,
  updateEmailValidation,
  updatePasswordValidation,
  updateProfileValidation,
} from "../../middlewares/formValidation";
import { authLimiter } from "../../middlewares/rateLimiter";
import { deleteObject } from "../../middlewares/AWSConfig";

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

router.get("/check-username/:username", verifyToken, async (req: any, res: any) => {
  try {
    const { username } = req.params;
    const normalized = username.toLowerCase();

    const existing = await req.prisma.user.findUnique({
      where: { username: normalized },
    });

    const available = !existing || existing.id === req.userId;

    res.status(200).json({
      available,
      message: available ? "Username is available" : "Username is taken",
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

router.patch(
  "/profile",
  verifyToken,
  updateProfileValidation,
  async (req: any, res: any) => {
    try {
      const userId = req.userId;
      const { name, username, profileImg, bannerImg } = req.body;

      const user = await req.prisma.user.findUnique({ where: { id: userId } });
      if (!user || user.isDeleted) {
        return res.status(401).json({ message: "Invalid Token" });
      }

      if (username !== undefined && username !== null && username !== "") {
        const normalized = username.toLowerCase();
        const handleRegex = /^[a-z0-9_-]+$/;
        if (!handleRegex.test(normalized)) {
          return res.status(400).json({
            message: "Username can only contain letters, numbers, underscores, and hyphens",
          });
        }
        if (normalized !== user.username) {
          const existing = await req.prisma.user.findUnique({
            where: { username: normalized },
          });
          if (existing) {
            return res.status(409).json({ message: "This username is already taken" });
          }
        }
      }

      if (profileImg && user.profileImg && user.profileImg !== profileImg) {
        try {
          await deleteObject(user.profileImg);
        } catch (e) {
          console.log("Error deleting old profile image:", e);
        }
      }

      if (bannerImg && user.bannerImg && user.bannerImg !== bannerImg) {
        try {
          await deleteObject(user.bannerImg);
        } catch (e) {
          console.log("Error deleting old banner image:", e);
        }
      }

      const updatedUser = await req.prisma.user.update({
        where: { id: userId },
        data: {
          ...(name !== undefined ? { name } : {}),
          ...(username !== undefined
            ? { username: username === "" || username === null ? null : username.toLowerCase() }
            : {}),
          ...(profileImg !== undefined ? { profileImg: profileImg || null } : {}),
          ...(bannerImg !== undefined ? { bannerImg: bannerImg || null } : {}),
        },
      });

      res.status(200).json({
        user: sanitizeUser(updatedUser),
        message: "Profile updated",
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  }
);

router.patch(
  "/email",
  verifyToken,
  authLimiter,
  updateEmailValidation,
  async (req: any, res: any) => {
    try {
      const userId = req.userId;
      const { email, currentPassword } = req.body;

      const user = await req.prisma.user.findUnique({ where: { id: userId } });
      if (!user || user.isDeleted) {
        return res.status(401).json({ message: "Invalid Token" });
      }

      const passwordMatched = await bcrypt.compare(currentPassword, user.password);
      if (!passwordMatched) {
        return res.status(401).json({ message: "Current password is incorrect" });
      }

      if (email.toLowerCase() !== user.email.toLowerCase()) {
        const existing = await req.prisma.user.findUnique({ where: { email } });
        if (existing) {
          return res.status(409).json({ message: "Email already in use" });
        }
      }

      const updatedUser = await req.prisma.user.update({
        where: { id: userId },
        data: { email },
      });

      res.status(200).json({
        user: sanitizeUser(updatedUser),
        message: "Email updated",
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  }
);

router.patch(
  "/password",
  verifyToken,
  authLimiter,
  updatePasswordValidation,
  async (req: any, res: any) => {
    try {
      const userId = req.userId;
      const { currentPassword, newPassword } = req.body;

      const user = await req.prisma.user.findUnique({ where: { id: userId } });
      if (!user || user.isDeleted) {
        return res.status(401).json({ message: "Invalid Token" });
      }

      const passwordMatched = await bcrypt.compare(currentPassword, user.password);
      if (!passwordMatched) {
        return res.status(401).json({ message: "Current password is incorrect" });
      }

      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(newPassword, salt);

      await req.prisma.user.update({
        where: { id: userId },
        data: { password: hashedPassword },
      });

      res.status(200).json({ message: "Password updated" });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  }
);

export default router;
