# ⚡ Quick Razorpay Setup - Production ke liye

## 🎯 3 Simple Steps

### Step 1: Razorpay Keys Lein
1. https://dashboard.razorpay.com par login karo
2. **Settings** → **API Keys**
3. **LIVE MODE** keys generate karo
4. Copy karo:
   - Key ID: `rzp_live_xxxxxxxxxxxxx`
   - Key Secret: `xxxxxxxxxxxxx`

### Step 2: Backend `.env` me Add Karo

`backend/.env` file me yeh add karo:

```env
RAZORPAY_KEY_ID=rzp_live_xxxxxxxxxxxxx
RAZORPAY_KEY_SECRET=your_secret_key_here
RAZORPAY_WEBHOOK_SECRET=your_webhook_secret_here
```

**Webhook Secret kaise milega?**
1. Razorpay Dashboard → **Settings** → **Webhooks**
2. Webhook URL add karo: `https://your-domain.com/api/webhooks/razorpay`
3. Events select karo (payment.captured, subscription.activated, etc.)
4. Webhook Secret copy karo

### Step 3: Frontend `.env` me Add Karo

Root directory me `.env` file me yeh add karo:

```env
EXPO_PUBLIC_RAZORPAY_KEY_ID=rzp_live_xxxxxxxxxxxxx
```

## ✅ Verify Karo

1. Backend restart karo
2. Frontend restart karo
3. Payment button click karo
4. Ab **mock response nahi aayega** - real Razorpay checkout open hoga!

## 🔒 Security Reminders

- ✅ Key Secret sirf backend me rakho
- ✅ Key ID frontend me safe hai (public key)
- ✅ `.env` files git me commit mat karo
- ✅ Production me HTTPS use karo

## 📝 Files to Update

1. `backend/.env` - Backend Razorpay keys
2. `.env` (root) - Frontend Razorpay key ID

## 🆘 Problem?

Agar abhi bhi "mock subscription" dikh raha hai:
1. Backend `.env` me keys properly set hain? Check karo
2. Backend server restart kiya? Restart karo
3. Frontend `.env` me `EXPO_PUBLIC_RAZORPAY_KEY_ID` set hai? Check karo
4. Frontend app restart kiya? Restart karo

## 📚 Detailed Guide

Complete setup guide ke liye: `RAZORPAY_PRODUCTION_SETUP.md` dekho
