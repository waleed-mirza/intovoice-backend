import {
  LoginSchema,
  SignupSchema,
  UpdateEmailSchema,
  UpdatePasswordSchema,
  UpdateProfileSchema,
} from "./validationSchema";

export const signupValidation = async (req: any, res: any, next: any) => {
  const { email, password, name } = req.body;

  // Validate the request body against the schema
  const validationResult = SignupSchema.validate({ email, password, name });

  if (validationResult.error) {
    // Return an error response if validation fails
    return res
      .status(400)
      .json({ message: validationResult.error.details[0].message });
  }
  next();
};
export const loginValidation = async (req: any, res: any, next: any) => {
  const { email, password } = req.body;

  // Validate the request body against the schema
  const validationResult = LoginSchema.validate({ email, password });

  if (validationResult.error) {
    // Return an error response if validation fails
    return res
      .status(400)
      .json({ message: validationResult.error.details[0].message });
  }
  next();
};

export const updateProfileValidation = async (req: any, res: any, next: any) => {
  const validationResult = UpdateProfileSchema.validate(req.body);
  if (validationResult.error) {
    return res
      .status(400)
      .json({ message: validationResult.error.details[0].message });
  }
  next();
};

export const updateEmailValidation = async (req: any, res: any, next: any) => {
  const validationResult = UpdateEmailSchema.validate(req.body);
  if (validationResult.error) {
    return res
      .status(400)
      .json({ message: validationResult.error.details[0].message });
  }
  next();
};

export const updatePasswordValidation = async (req: any, res: any, next: any) => {
  const validationResult = UpdatePasswordSchema.validate(req.body);
  if (validationResult.error) {
    return res
      .status(400)
      .json({ message: validationResult.error.details[0].message });
  }
  next();
};
