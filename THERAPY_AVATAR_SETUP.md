# Therapy Avatar Website Setup - Quick Guide

## ✅ Code Already Updated!

Therapy Avatar section ab external website ko open karega. Jab user "Therapy Avatar" card par click karega, to wo website new tab/browser me khul jayegi.

## 🚀 Quick Setup (3 Steps)

### Step 1: Therapy Avatar Website Ko Vercel Pe Deploy Karo

```bash
# Option A: GitHub se (Recommended)
cd your-therapy-avatar-website
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/yourusername/therapy-avatar.git
git push -u origin main

# Phir Vercel Dashboard se connect karo
# https://vercel.com/dashboard → Add New Project → GitHub repo select → Deploy
```

Ya CLI se:
```bash
npm i -g vercel
cd your-therapy-avatar-website
vercel --prod
```

### Step 2: URL Set Karo

**Option A: Environment Variable (Recommended)**

`.env.local` file me add karo:
```env
EXPO_PUBLIC_THERAPY_AVATAR_URL=https://therapy-avatar.vercel.app
```

**Option B: Direct Code Me (Already Updated!)**

`app/(tabs)/TherapyProgress.tsx` me line 27 pe default URL already set hai:
```typescript
const THERAPY_AVATAR_URL = process.env.EXPO_PUBLIC_THERAPY_AVATAR_URL || 'https://therapy-avatar.vercel.app';
```

✅ **Code me URL already update ho chuka hai!** Agar environment variable set nahi kiya, to default URL use hoga.

### Step 3: Test Karo

```bash
npm start
# Web me open karo
# Therapy Avatar card par click karo
# Website new tab me khulni chahiye! ✅
```

## 📝 Current Implementation

- **Web:** `window.open()` se new tab me khulta hai
- **Native (iOS/Android):** `Linking.openURL()` se browser me khulta hai
- **Error Handling:** Agar URL invalid hai ya open nahi ho sakta, to alert show hota hai

## 🔧 Production Deploy

Agar main app bhi Vercel pe deploy karna hai:

1. **Vercel Environment Variables:**
   - Project → Settings → Environment Variables
   - Add: `EXPO_PUBLIC_THERAPY_AVATAR_URL` = `https://your-therapy-avatar.vercel.app`

2. **Build & Deploy:**
   ```bash
   npm run build
   vercel --prod
   ```

## ❓ Troubleshooting

**Website open nahi ho rahi?**
- Console me URL check karo: `console.log('[TherapyProgress] Opening:', url)`
- Browser me manually URL test karo
- Environment variable set hai ya nahi verify karo

**Vercel deployment issue?**
- `vercel logs` se logs check karo
- Framework auto-detect ho raha hai ya nahi verify karo

## 📚 Detailed Guide

Complete guide ke liye: `VERCEL_DEPLOYMENT_GUIDE.md` file dekho.
