import Joi from "joi";

export const SignupSchema = Joi.object({
  name: Joi.string().min(3).required(),
  email: Joi.string().email().required(),
  password: Joi.string().min(6).required(),
});
export const LoginSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().min(6).required(),
});

export const UpdateProfileSchema = Joi.object({
  name: Joi.string().min(3).max(100),
  username: Joi.string()
    .min(3)
    .max(30)
    .pattern(/^[a-z0-9_-]+$/)
    .allow(null, ""),
  profileImg: Joi.string().max(500).allow(null, ""),
}).min(1);

export const UpdateEmailSchema = Joi.object({
  email: Joi.string().email().required(),
  currentPassword: Joi.string().min(6).required(),
});

export const UpdatePasswordSchema = Joi.object({
  currentPassword: Joi.string().min(6).required(),
  newPassword: Joi.string().min(6).required(),
});

