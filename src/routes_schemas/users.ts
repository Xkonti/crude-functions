import { z } from "zod";
import { IdSchema } from "../schemas/common.ts";

/**
 * User data returned from API
 */
export const UserSchema = z.object({
  id: z.string().openapi({
    example: "user_abc123",
    description: "Unique user ID",
  }),
  email: z.string().email().openapi({
    example: "user@example.com",
    description: "User email address",
  }),
  name: z.string().nullable().openapi({
    example: "John Doe",
    description: "User display name",
  }),
  roles: z.array(z.string()).openapi({
    example: ["admin"],
    description: "User roles",
  }),
  createdAt: z.string().datetime().openapi({
    example: "2026-01-10T12:34:56.789Z",
    description: "When the user was created",
  }),
}).openapi("User");

/**
 * Request body for POST /api/users - Create user
 */
export const CreateUserRequestSchema = z.object({
  email: z.string().email().openapi({
    example: "user@example.com",
    description: "User email address",
  }),
  password: z.string().min(8).openapi({
    example: "SecureP@ssw0rd",
    description: "User password (minimum 8 characters)",
  }),
  passwordConfirmation: z.string().openapi({
    example: "SecureP@ssw0rd",
    description: "Password confirmation (must match password)",
  }),
  name: z.string().optional().openapi({
    example: "John Doe",
    description: "Optional user display name",
  }),
  roles: z.array(z.string()).optional().openapi({
    example: ["admin"],
    description: "Optional user roles",
  }),
}).refine((data) => data.password === data.passwordConfirmation, {
  message: "Passwords do not match",
  path: ["passwordConfirmation"],
}).openapi("CreateUserRequest");

/**
 * Response schema for POST /api/users
 */
export const CreateUserResponseSchema = z.object({
  id: z.string().openapi({
    example: "user_abc123",
    description: "Created user ID",
  }),
  email: z.string().email().openapi({
    example: "user@example.com",
    description: "User email address",
  }),
  roles: z.array(z.string()).openapi({
    example: ["admin"],
    description: "User roles",
  }),
}).openapi("CreateUserResponse");

/**
 * Response schema for GET /api/users - List all users
 */
export const GetUsersResponseSchema = z.object({
  users: z.array(UserSchema).openapi({
    description: "Array of all users",
  }),
}).openapi("GetUsersResponse");

/**
 * Path parameter for user ID
 */
export const UserIdParamSchema = z.object({
  id: z.string().openapi({
    param: {
      name: "id",
      in: "path",
    },
    example: "user_abc123",
    description: "User ID",
  }),
});

/**
 * Request body for PUT /api/users/:id - Update user
 */
export const UpdateUserRequestSchema = z.object({
  password: z.string().min(8).optional().openapi({
    example: "NewSecureP@ssw0rd",
    description: "New password (minimum 8 characters)",
  }),
  passwordConfirmation: z.string().optional().openapi({
    example: "NewSecureP@ssw0rd",
    description: "Password confirmation (required if password provided)",
  }),
  roles: z.array(z.string()).optional().openapi({
    example: ["admin", "developer"],
    description: "Updated user roles",
  }),
}).refine(
  (data) => {
    if (data.password !== undefined) {
      return data.passwordConfirmation !== undefined &&
        data.password === data.passwordConfirmation;
    }
    return true;
  },
  {
    message: "Password confirmation required and must match password",
    path: ["passwordConfirmation"],
  }
).openapi("UpdateUserRequest");

/**
 * Response schema for PUT /api/users/:id
 */
export const UpdateUserResponseSchema = z.object({
  success: z.boolean().openapi({
    example: true,
  }),
}).openapi("UpdateUserResponse");

/**
 * Response schema for DELETE /api/users/:id
 */
export const DeleteUserResponseSchema = z.object({
  success: z.boolean().openapi({
    example: true,
  }),
}).openapi("DeleteUserResponse");
