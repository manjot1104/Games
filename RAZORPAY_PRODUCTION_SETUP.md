# Razorpay Production Setup Guide

## 🚀 Quick Setup for Production

Yeh guide aapko production ke liye real Razorpay payment gateway setup karne me help karega.

## Step 1: Razorpay Account Setup

### 1.1 Razorpay Account Banao
1. https://razorpay.com par jao
2. "Sign Up" click karo
3. Business details fill karo
4. Account verify karo (KYC required for live payments)

### 1.2 API Keys Lein
1. Razorpay Dashboard me jao: https://dashboard.razorpay.com
2. **Settings** → **API Keys** par click karo
3. **Generate Keys** button click karo
4. **LIVE MODE** keys generate karo (production ke liye)
   - Key ID: `rzp_live_xxxxxxxxxxxxx` (yeh frontend me use hoga)
   - Key Secret: `xxxxxxxxxxxxx` (yeh sirf backend me use hoga - SECRET!)

⚠️ **IMPORTANT**: 
- Test mode keys (`rzp_test_`) sirf testing ke liye hain
- Production me **LIVE mode keys** (`rzp_live_`) use karo
- Key Secret ko kabhi bhi frontend me expose mat karo!

## Step 2: Backend Configuration

### 2.1 Backend `.env` File Setup

`backend/.env` file me yeh add karo:

```env
# Razorpay LIVE Mode Keys (Production)
RAZORPAY_KEY_ID=rzp_live_xxxxxxxxxxxxx
RAZORPAY_KEY_SECRET=your_live_secret_key_here
RAZORPAY_WEBHOOK_SECRET=your_webhook_secret_here

# Optional: Pre-created Plan ID
RAZORPAY_PLAN_ID=plan_xxxxxxxxxxxxx

# MongoDB
MONGODB_URI=mongodb://127.0.0.1:27017/child_wellness

# Server
PORT=4000
```

### 2.2 Webhook Setup

1. Razorpay Dashboard → **Settings** → **Webhooks**
2. **Add New Webhook** click karo
3. Webhook URL add karo: `https://your-production-domain.com/api/webhooks/razorpay`
4. Select these events:
   - ✅ `payment.captured`
   - ✅ `payment.failed`
   - ✅ `subscription.activated`
   - ✅ `subscription.cancelled`
   - ✅ `subscription.charged`
   - ✅ `subscription.paused`
   - ✅ `subscription.resumed`
5. **Webhook Secret** copy karo aur `RAZORPAY_WEBHOOK_SECRET` me add karo

## Step 3: Frontend Configuration

### 3.1 Frontend `.env` File Setup

Root directory me `.env` file me yeh add karo:

```env
# Razorpay Key ID (PUBLIC - Safe to expose)
EXPO_PUBLIC_RAZORPAY_KEY_ID=rzp_live_xxxxxxxxxxxxx

# API Base URL (Production)
EXPO_PUBLIC_API_BASE_URL=https://your-api-domain.com
```

⚠️ **Note**: 
- Sirf `RAZORPAY_KEY_ID` frontend me rakho
- `RAZORPAY_KEY_SECRET` kabhi frontend me mat rakho!

## Step 4: Subscription Plan Setup

### Option A: Automatic Plan Creation (Recommended)
Code automatically plan create karega jab pehli baar subscription banegi. Kuch karna nahi hai.

### Option B: Manual Plan Creation
1. Razorpay Dashboard → **Products** → **Plans**
2. **Create Plan** click karo
3. Details fill karo:
   - **Name**: Monthly Therapy Access
   - **Amount**: ₹299.00
   - **Billing Period**: Monthly
   - **Interval**: 1 month
4. Plan ID copy karo aur `RAZORPAY_PLAN_ID` me add karo

## Step 5: Testing

### 5.1 Test Mode me Test Karo (Pehle)
1. Test mode keys use karo (`rzp_test_`)
2. Test cards use karo:
   - **Success**: `4111 1111 1111 1111`
   - **Failure**: `4000 0000 0000 0002`
   - CVV: Any 3 digits
   - Expiry: Any future date

### 5.2 Production me Deploy Karo
1. Live mode keys use karo (`rzp_live_`)
2. Real payment test karo (small amount se)
3. Webhook events verify karo

## Step 6: Security Checklist

- [ ] Backend `.env` file `.gitignore` me hai
- [ ] Frontend `.env` me sirf public key hai
- [ ] Webhook secret properly configured hai
- [ ] HTTPS enabled hai production me
- [ ] Webhook URL production domain par point kar raha hai
- [ ] Database backups setup kiye gaye hain
- [ ] Error logging properly configured hai

## Step 7: Verify Setup

### Backend Check:
```bash
cd backend
node -e "require('dotenv').config(); console.log('Key ID:', process.env.RAZORPAY_KEY_ID ? '✅ Set' : '❌ Missing'); console.log('Key Secret:', process.env.RAZORPAY_KEY_SECRET ? '✅ Set' : '❌ Missing');"
```

### Frontend Check:
Browser console me check karo:
```javascript
console.log('Razorpay Key:', process.env.EXPO_PUBLIC_RAZORPAY_KEY_ID);
```

## Common Issues & Solutions

### Issue 1: "Mock subscription response detected"
**Solution**: Backend `.env` me `RAZORPAY_KEY_ID` aur `RAZORPAY_KEY_SECRET` properly set karo.

### Issue 2: "Razorpay checkout not opening"
**Solution**: Frontend `.env` me `EXPO_PUBLIC_RAZORPAY_KEY_ID` set karo aur app restart karo.

### Issue 3: "Payment verification failed"
**Solution**: Webhook secret verify karo aur backend me `RAZORPAY_WEBHOOK_SECRET` set karo.

### Issue 4: "Webhook signature verification failed"
**Solution**: Razorpay dashboard me webhook secret verify karo aur backend `.env` me update karo.

## Production Deployment

### Vercel/Netlify (Frontend):
1. Environment variables me add karo:
   - `EXPO_PUBLIC_RAZORPAY_KEY_ID`
   - `EXPO_PUBLIC_API_BASE_URL`

### Railway/Render (Backend):
1. Environment variables me add karo:
   - `RAZORPAY_KEY_ID`
   - `RAZORPAY_KEY_SECRET`
   - `RAZORPAY_WEBHOOK_SECRET`
   - `MONGODB_URI`
   - `PORT`

## Support

- Razorpay Docs: https://razorpay.com/docs/
- Razorpay Support: support@razorpay.com
- Razorpay Dashboard: https://dashboard.razorpay.com

## Important Notes

1. **Test Mode vs Live Mode**:
   - Test mode: `rzp_test_` - No real money
   - Live mode: `rzp_live_` - Real payments

2. **Key Security**:
   - Key Secret kabhi bhi frontend me expose mat karo
   - `.env` files ko git me commit mat karo
   - Production me environment variables use karo

3. **Webhook Security**:
   - Webhook secret always verify karo
   - HTTPS use karo production me
   - Webhook URL publicly accessible hona chahiye

4. **Testing**:
   - Pehle test mode me properly test karo
   - Phir live mode me small amount se test karo
   - Production me deploy karo
