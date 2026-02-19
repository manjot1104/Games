# Therapy Avatar Website - Vercel Deployment Guide

## Overview
Therapy Avatar section ab external website ko open karega. Jab user "Therapy Avatar" card par click karega, to wo website new tab/browser me khul jayegi.

## Step 1: Therapy Avatar Website Ko Vercel Pe Deploy Karo

### Option A: GitHub Se Deploy (Recommended)

1. **GitHub Repository Banao:**
   ```bash
   cd your-therapy-avatar-website
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/yourusername/therapy-avatar-website.git
   git push -u origin main
   ```

2. **Vercel Pe Connect Karo:**
   - [Vercel Dashboard](https://vercel.com/dashboard) pe jao
   - "Add New Project" click karo
   - GitHub repository select karo
   - "Deploy" button click karo
   - Vercel automatically detect kar lega framework (React, Next.js, etc.)

3. **Deployment URL Note Karo:**
   - Deployment complete hone ke baad, URL mil jayega
   - Example: `https://therapy-avatar-xyz.vercel.app`

### Option B: Vercel CLI Se Deploy

```bash
# Vercel CLI install karo
npm i -g vercel

# Project folder me jao
cd your-therapy-avatar-website

# Deploy karo
vercel

# Production deploy
vercel --prod
```

## Step 2: Environment Variable Set Karo

### Local Development (.env.local)

`.env.local` file me add karo:

```env
EXPO_PUBLIC_THERAPY_AVATAR_URL=https://therapy-avatar.vercel.app
```

### Production (Vercel Environment Variables)

1. Vercel Dashboard → Project → Settings → Environment Variables
2. Add karo:
   - **Name:** `EXPO_PUBLIC_THERAPY_AVATAR_URL`
   - **Value:** `https://your-therapy-avatar.vercel.app`
   - **Environment:** Production, Preview, Development (sab me add karo)

## Step 3: Code Me URL Update Karo

Agar environment variable set nahi kiya, to directly code me update kar sakte ho:

`app/(tabs)/TherapyProgress.tsx` me:

```typescript
const THERAPY_AVATAR_URL = 'https://your-therapy-avatar.vercel.app';
```

## Step 4: Test Karo

1. Local me test:
   ```bash
   npm start
   # Web me open karo
   ```

2. Therapy Avatar card par click karo
3. Website new tab me khulni chahiye

## Step 5: Production Deploy

Main app ko bhi Vercel pe deploy karo (agar web version hai):

```bash
# Expo web build
npm run build

# Vercel pe deploy
vercel --prod
```

## Important Notes

### CORS Issues (Agar Website Different Domain Pe Hai)

Agar Therapy Avatar website different domain pe hai, to CORS headers set karo:

**Next.js (Therapy Avatar Website):**
```javascript
// next.config.js
module.exports = {
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'Access-Control-Allow-Origin',
            value: '*', // Ya specific domain: 'https://your-main-app.vercel.app'
          },
        ],
      },
    ];
  },
};
```

### Iframe Embed (Alternative Approach)

Agar website ko iframe me embed karna hai (instead of new tab), to:

1. `app/(tabs)/TherapyProgress.tsx` me modify karo:
   ```typescript
   if (therapyId === 'therapy-avatar') {
     // Navigate to iframe screen
     router.push({
       pathname: '/(tabs)/TherapyAvatarWebView',
       params: { url: THERAPY_AVATAR_URL },
     });
     return;
   }
   ```

2. New screen banao: `app/(tabs)/TherapyAvatarWebView.tsx`
   ```typescript
   import { WebView } from 'react-native-webview';
   // ... implementation
   ```

## Troubleshooting

### Website Open Nahi Ho Rahi

1. **URL Check Karo:**
   - Console me URL print karo: `console.log('[TherapyProgress] Opening:', url)`
   - Browser me manually test karo

2. **Platform Check:**
   - Web: `window.open()` use ho raha hai
   - Native: `Linking.openURL()` use ho raha hai

3. **Permissions (Native):**
   - iOS: `Info.plist` me URL scheme add karo
   - Android: `AndroidManifest.xml` me internet permission check karo

### Vercel Deployment Issues

1. **Build Errors:**
   - `vercel logs` se logs check karo
   - Framework detection verify karo

2. **Environment Variables:**
   - Vercel Dashboard me variables set ho rahe hain ya nahi check karo
   - Redeploy karo after adding variables

## Example: Complete Setup

```bash
# 1. Therapy Avatar website folder
cd therapy-avatar-website
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/yourusername/therapy-avatar.git
git push -u origin main

# 2. Vercel pe deploy
vercel

# 3. Main app me .env.local update
echo "EXPO_PUBLIC_THERAPY_AVATAR_URL=https://therapy-avatar-xyz.vercel.app" >> .env.local

# 4. Restart dev server
npm start
```

## Support

Agar koi issue aaye, to:
1. Console logs check karo
2. Network tab me request verify karo
3. Vercel deployment logs check karo
