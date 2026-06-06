import { LoginSchema, SignupSchema } from "./validationSchema";

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
