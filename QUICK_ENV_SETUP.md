# Quick Environment Variable Setup

## ✅ Therapy Avatar URL Kahan Add Karna Hai?

**Answer: Frontend root directory me `.env.local` file me add karo**

## 📍 Location

```
Games/                    ← Root directory (yahan)
├── .env.local           ← YAHAN ADD KARO ✅
├── backend/
│   └── .env            ← Backend ke liye (yeh nahi)
└── ...
```

## 🚀 Steps

### Step 1: `.env.local` File Banao (Agar Nahi Hai)

Project root me (backend folder ke bahar):

```bash
# Windows PowerShell
New-Item -Path .env.local -ItemType File

# Mac/Linux
touch .env.local
```

### Step 2: Content Add Karo

`.env.local` file me yeh add karo:

```env
# Therapy Avatar Website URL
EXPO_PUBLIC_THERAPY_AVATAR_URL=https://therapy-avatar.vercel.app
```

**Note:** Code me URL already hardcoded hai, to environment variable optional hai.

### Step 3: Dev Server Restart Karo

```bash
# Stop current server (Ctrl+C)
# Phir restart
npm start
```

## 📝 Complete `.env.local` Example

Agar pehle se kuch variables hain, to unke saath add karo:

```env
# API Base URL
EXPO_PUBLIC_API_BASE_URL=http://localhost:4000

# Razorpay Key ID
EXPO_PUBLIC_RAZORPAY_KEY_ID=rzp_live_xxxxxxxxxxxxx

# Therapy Avatar Website URL
EXPO_PUBLIC_THERAPY_AVATAR_URL=https://your-therapy-avatar.vercel.app
```

## ❓ FAQ

**Q: Backend `.env` me add karu?**  
A: ❌ Nahi! Backend me nahi. Frontend root directory me `.env.local` me add karo.

**Q: `.env` ya `.env.local`?**  
A: `.env.local` recommended hai (git me ignore hota hai, secure hai).

**Q: Production me kaise set karu?**  
A: Vercel Dashboard → Project → Settings → Environment Variables → Add `EXPO_PUBLIC_THERAPY_AVATAR_URL`

**Q: Variable kaam nahi kar raha?**  
A: 
1. Dev server restart karo
2. `.env.local` file root me hai ya nahi check karo
3. Variable name exactly `EXPO_PUBLIC_THERAPY_AVATAR_URL` hai ya nahi verify karo

## ✅ Verify Karo

Console me check karo:
```javascript
console.log('[TherapyProgress] Opening Therapy Avatar website:', url);
```

Agar URL correct print ho raha hai, to setup sahi hai! 🎉
