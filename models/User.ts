/**
 * User Model
 * Kullanıcı veritabanı modeli
 */

import mongoose, { Schema, Model } from 'mongoose';
import bcrypt from 'bcryptjs';

export interface IUser {
  _id: mongoose.Types.ObjectId;
  name: string;
  email: string;
  password?: string;
  image?: string;
  emailVerified?: Date;
  role: 'user' | 'admin';
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface IUserMethods {
  comparePassword(candidatePassword: string): Promise<boolean>;
}

type UserModel = Model<IUser, object, IUserMethods>;

const UserSchema = new Schema<IUser, UserModel, IUserMethods>(
  {
    name: {
      type: String,
      required: [true, 'İsim gerekli'],
      trim: true,
      minlength: [2, 'İsim en az 2 karakter olmalı'],
      maxlength: [50, 'İsim en fazla 50 karakter olabilir'],
    },
    email: {
      type: String,
      required: [true, 'E-posta gerekli'],
      unique: true,
      trim: true,
      lowercase: true,
      match: [/^\S+@\S+\.\S+$/, 'Geçerli bir e-posta girin'],
    },
    password: {
      type: String,
      minlength: [6, 'Şifre en az 6 karakter olmalı'],
      select: false, // Default olarak password'ü getirme
    },
    image: {
      type: String,
    },
    emailVerified: {
      type: Date,
    },
    role: {
      type: String,
      enum: ['user', 'admin'],
      default: 'user',
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

// Password hash'leme (kaydetmeden önce)
UserSchema.pre('save', async function (next) {
  // Şifre değişmediyse geç
  if (!this.isModified('password')) {
    return next();
  }

  // Şifre varsa hash'le
  if (this.password) {
    const salt = await bcrypt.genSalt(12);
    this.password = await bcrypt.hash(this.password, salt);
  }

  next();
});

// Şifre karşılaştırma metodu
UserSchema.methods.comparePassword = async function (
  candidatePassword: string
): Promise<boolean> {
  if (!this.password) return false;
  return bcrypt.compare(candidatePassword, this.password);
};

// Indexes (email index'i schema'da unique: true ile tanımlı)
UserSchema.index({ role: 1 });
UserSchema.index({ createdAt: -1 });

const User: UserModel =
  mongoose.models.User || mongoose.model<IUser, UserModel>('User', UserSchema);

export default User;

