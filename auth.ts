/**
 * NextAuth.js Configuration
 * Kimlik doğrulama yapılandırması
 */

import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { MongoDBAdapter } from '@auth/mongodb-adapter';
import clientPromise from '@/lib/mongodb-client';
import dbConnect from '@/lib/mongodb';
import User from '@/models/User';
import type { NextAuthConfig } from 'next-auth';

// Auth options
const authConfig: NextAuthConfig = {
  adapter: MongoDBAdapter(clientPromise),
  
  providers: [
    Credentials({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          throw new Error('E-posta ve şifre gerekli');
        }

        await dbConnect();

        // Kullanıcıyı bul (password'ü de getir)
        const user = await User.findOne({ 
          email: credentials.email 
        }).select('+password');

        if (!user) {
          throw new Error('E-posta veya şifre hatalı');
        }

        if (!user.isActive) {
          throw new Error('Hesabınız devre dışı bırakılmış');
        }

        // Şifre kontrolü
        const isPasswordValid = await user.comparePassword(
          credentials.password as string
        );

        if (!isPasswordValid) {
          throw new Error('E-posta veya şifre hatalı');
        }

        // Kullanıcı bilgilerini döndür
        return {
          id: user._id.toString(),
          name: user.name,
          email: user.email,
          image: user.image,
          role: user.role,
        };
      },
    }),
  ],

  session: {
    strategy: 'jwt',
    maxAge: 30 * 24 * 60 * 60, // 30 gün
  },

  pages: {
    signIn: '/login',
    error: '/login',
  },

  callbacks: {
    async jwt({ token, user }) {
      // İlk login'de user bilgilerini token'a ekle
      if (user) {
        token.id = user.id;
        token.role = user.role;
      }
      return token;
    },

    async session({ session, token }) {
      // Token'dan session'a bilgi aktar
      if (token && session.user) {
        session.user.id = token.id as string;
        session.user.role = token.role as string;
      }
      return session;
    },

    async redirect({ url, baseUrl }) {
      // Relative URL'leri base URL ile birleştir
      if (url.startsWith('/')) {
        return `${baseUrl}${url}`;
      }
      // Aynı origin'deki URL'lere izin ver
      if (new URL(url).origin === baseUrl) {
        return url;
      }
      return baseUrl;
    },
  },

  events: {
    async signIn({ user }) {
      console.log(`User signed in: ${user.email}`);
    },
    async signOut() {
      console.log('User signed out');
    },
  },

  debug: process.env.NODE_ENV === 'development',
};

export const { handlers, signIn, signOut, auth } = NextAuth(authConfig);

