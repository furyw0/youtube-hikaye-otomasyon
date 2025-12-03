/**
 * Change Password API Route
 * Şifre değiştirme
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import dbConnect from '@/lib/mongodb';
import User from '@/models/User';
import { z } from 'zod';

// Validation schema
const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Mevcut şifre gerekli'),
  newPassword: z
    .string()
    .min(6, 'Yeni şifre en az 6 karakter olmalı')
    .max(100, 'Şifre en fazla 100 karakter olabilir'),
  confirmPassword: z.string().min(1, 'Şifre tekrarı gerekli'),
}).refine((data) => data.newPassword === data.confirmPassword, {
  message: 'Şifreler eşleşmiyor',
  path: ['confirmPassword'],
});

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Yetkisiz erişim' },
        { status: 401 }
      );
    }

    const body = await request.json();

    // Validation
    const validationResult = changePasswordSchema.safeParse(body);
    if (!validationResult.success) {
      return NextResponse.json(
        { error: validationResult.error.errors[0].message },
        { status: 400 }
      );
    }

    const { currentPassword, newPassword } = validationResult.data;

    await dbConnect();

    // Kullanıcıyı bul (password'ü de getir)
    const user = await User.findById(session.user.id).select('+password');

    if (!user) {
      return NextResponse.json(
        { error: 'Kullanıcı bulunamadı' },
        { status: 404 }
      );
    }

    // Mevcut şifre kontrolü
    const isPasswordValid = await user.comparePassword(currentPassword);
    if (!isPasswordValid) {
      return NextResponse.json(
        { error: 'Mevcut şifre hatalı' },
        { status: 400 }
      );
    }

    // Yeni şifre eskisi ile aynı mı?
    const isSamePassword = await user.comparePassword(newPassword);
    if (isSamePassword) {
      return NextResponse.json(
        { error: 'Yeni şifre eskisi ile aynı olamaz' },
        { status: 400 }
      );
    }

    // Şifreyi güncelle
    user.password = newPassword;
    await user.save();

    return NextResponse.json({
      success: true,
      message: 'Şifre başarıyla değiştirildi',
    });
  } catch (error) {
    console.error('Change password error:', error);
    return NextResponse.json(
      { error: 'Şifre değiştirilemedi' },
      { status: 500 }
    );
  }
}

