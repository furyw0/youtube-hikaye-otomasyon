/**
 * Register API Route
 * Yeni kullanıcı kaydı
 */

import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import User from '@/models/User';
import { z } from 'zod';

// Validation schema
const registerSchema = z.object({
  name: z
    .string()
    .min(2, 'İsim en az 2 karakter olmalı')
    .max(50, 'İsim en fazla 50 karakter olabilir'),
  email: z.string().email('Geçerli bir e-posta girin'),
  password: z
    .string()
    .min(6, 'Şifre en az 6 karakter olmalı')
    .max(100, 'Şifre en fazla 100 karakter olabilir'),
});

export async function POST(request: Request) {
  try {
    const body = await request.json();

    // Validation
    const validationResult = registerSchema.safeParse(body);
    if (!validationResult.success) {
      return NextResponse.json(
        { error: validationResult.error.errors[0].message },
        { status: 400 }
      );
    }

    const { name, email, password } = validationResult.data;

    await dbConnect();

    // E-posta kontrolü
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return NextResponse.json(
        { error: 'Bu e-posta adresi zaten kayıtlı' },
        { status: 400 }
      );
    }

    // Yeni kullanıcı oluştur
    const user = await User.create({
      name,
      email: email.toLowerCase(),
      password,
    });

    return NextResponse.json(
      {
        success: true,
        message: 'Hesabınız başarıyla oluşturuldu',
        user: {
          id: user._id.toString(),
          name: user.name,
          email: user.email,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('Register error:', error);
    return NextResponse.json(
      { error: 'Kayıt sırasında bir hata oluştu' },
      { status: 500 }
    );
  }
}

