// Quick script to check if Razorpay keys are loaded
import 'dotenv/config';

console.log('\n🔍 Checking Razorpay Keys Configuration...\n');

const keyId = process.env.RAZORPAY_KEY_ID;
const keySecret = process.env.RAZORPAY_KEY_SECRET;

console.log('RAZORPAY_KEY_ID:', keyId ? `✅ SET (${keyId.substring(0, 10)}...)` : '❌ NOT SET');
console.log('RAZORPAY_KEY_SECRET:', keySecret ? '✅ SET (hidden)' : '❌ NOT SET');

if (keyId && keySecret && keyId.trim() !== '' && keySecret.trim() !== '') {
  console.log('\n✅ Razorpay keys are properly configured!');
  console.log('   Key ID starts with:', keyId.startsWith('rzp_live_') ? 'rzp_live_ (LIVE MODE)' : keyId.startsWith('rzp_test_') ? 'rzp_test_ (TEST MODE)' : 'Unknown format');
} else {
  console.log('\n❌ Razorpay keys are NOT configured!');
  console.log('\n📝 To fix this:');
  console.log('   1. Open backend/.env file');
  console.log('   2. Add these lines:');
  console.log('      RAZORPAY_KEY_ID=rzp_live_xxxxxxxxxxxxx');
  console.log('      RAZORPAY_KEY_SECRET=your_secret_key_here');
  console.log('   3. Restart backend server');
}

console.log('\n');
