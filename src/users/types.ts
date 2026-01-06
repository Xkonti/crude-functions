/**
 * Public user type with parsed roles and proper TypeScript types.
 * This is what consumers of UserService will work with.
 */
export interface User {
  /** Unique user identifier (UUID from Better Auth) */
  id: string;
  /** Email address (unique) */
  email: string;
  /** Whether email has been verified */
  emailVerified: boolean;
  /** Optional display name */
  name?: string;
  /** Optional profile image URL */
  image?: string;
  /** Parsed role array (from comma-separated string in database) */
  roles: string[];
  /** Whether user is banned */
  banned: boolean;
  /** Reason for ban (if banned) */
  banReason?: string;
  /** Ban expiration timestamp (if temporary ban) */
  banExpires?: Date;
  /** Account creation timestamp */
  createdAt: Date;
  /** Last update timestamp */
  updatedAt: Date;
}

/**
 * Input for creating a new user.
 * Password is required, email verification defaults to false.
 */
export interface CreateUserData {
  /** Email address (must be unique and valid) */
  email: string;
  /** Password (minimum 8 characters) */
  password: string;
  /** Optional display name */
  name?: string;
  /** Optional role string (comma-separated, e.g., "userMgmt" or "permanent,userMgmt") */
  role?: string;
}

/**
 * Input for updating an existing user.
 * All fields are optional - only provided fields will be updated.
 */
export interface UpdateUserData {
  /** New password (minimum 8 characters if provided) */
  password?: string;
  /** New role string (comma-separated) */
  role?: string;
  /** New display name */
  name?: string;
  /** New email (must be unique and valid if provided) */
  email?: string;
}

/**
 * Session information from Better Auth.
 * Returned when getting the current authenticated user.
 */
export interface UserSession {
  /** The authenticated user */
  user: {
    id: string;
    email: string;
    name?: string;
    emailVerified: boolean;
  };
  /** Session metadata */
  session: {
    id: string;
    userId: string;
    expiresAt: Date;
    token: string;
    ipAddress?: string;
    userAgent?: string;
  };
}
