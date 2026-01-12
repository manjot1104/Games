// components/game/ResultCard.tsx
import React, { useEffect } from 'react';
import { Platform, Text, TouchableOpacity, View } from 'react-native';
import Animated, { 
  useAnimatedProps, 
  useSharedValue, 
  withTiming, 
  withRepeat, 
  withSequence,
  Easing,
  useAnimatedStyle
} from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';
import { SparkleBurst } from '@/components/game/FX';
import ReflectionPrompt from '@/components/game/ReflectionPrompt';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const AnimatedText = Animated.createAnimatedComponent(Text);

// Animated Confetti Emoji Component
function AnimatedConfettiEmoji({ 
  isCelebrating, 
  size = 180 
}: { 
  isCelebrating: boolean; 
  size?: number;
}) {
  const scale = useSharedValue(1);
  const rotation = useSharedValue(0);
  const bounce = useSharedValue(0);
  const opacity = useSharedValue(1);

  useEffect(() => {
    if (isCelebrating) {
      // Celebration animation: dramatic scale, rotate, and bounce (plays once, like celebratoryCat)
      scale.value = withSequence(
        withTiming(1.3, { duration: 400, easing: Easing.out(Easing.back(1.5)) }),
        withTiming(1, { duration: 300, easing: Easing.in(Easing.ease) })
      );
      rotation.value = withSequence(
        withTiming(20, { duration: 400 }),
        withTiming(-20, { duration: 400 }),
        withTiming(10, { duration: 300 }),
        withTiming(0, { duration: 300 })
      );
      bounce.value = withSequence(
        withTiming(-15, { duration: 400 }),
        withTiming(0, { duration: 300 }),
        withTiming(-8, { duration: 250 }),
        withTiming(0, { duration: 250 })
      );
    } else {
      // Chill animation: gentle continuous looping animation (like chillCat)
      scale.value = withRepeat(
        withSequence(
          withTiming(1.08, { duration: 1500, easing: Easing.inOut(Easing.ease) }),
          withTiming(1, { duration: 1500, easing: Easing.inOut(Easing.ease) })
        ),
        -1,
        false
      );
      rotation.value = withRepeat(
        withSequence(
          withTiming(8, { duration: 1800, easing: Easing.inOut(Easing.ease) }),
          withTiming(-8, { duration: 1800, easing: Easing.inOut(Easing.ease) })
        ),
        -1,
        false
      );
      bounce.value = withRepeat(
        withSequence(
          withTiming(-5, { duration: 1600, easing: Easing.inOut(Easing.ease) }),
          withTiming(0, { duration: 1600, easing: Easing.inOut(Easing.ease) })
        ),
        -1,
        false
      );
    }
  }, [isCelebrating]);

  const animatedStyle = useAnimatedStyle(() => {
    return {
      transform: [
        { scale: scale.value },
        { rotate: `${rotation.value}deg` },
        { translateY: bounce.value }
      ],
      opacity: opacity.value,
    };
  });

  return (
    <Animated.View style={[{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }, animatedStyle]}>
      <AnimatedText style={{ fontSize: size * 0.7, textAlign: 'center' }}>
        🎉
      </AnimatedText>
    </Animated.View>
  );
}

export default function ResultCard({
  correct,
  total,
  onPlayAgain,
  onHome,
  onContinue,
  xpAwarded,
  accuracy,
  logTimestamp,
}: {
  correct: number;
  total: number;
  onPlayAgain?: () => void;
  onHome?: () => void;
  onContinue?: () => void;
  xpAwarded?: number;
  accuracy?: number;
  logTimestamp?: string | null;
}) {
  const pct = total ? correct / total : 0;
  const prog = useSharedValue(0);
  const displayedAccuracy = accuracy !== undefined ? accuracy : Math.round(pct * 100);

  useEffect(() => { prog.value = 0; prog.value = withTiming(pct, { duration: 700 }); }, [pct]);

  const R = 56, C = 2 * Math.PI * R;
  const props: any = useAnimatedProps(() => ({ strokeDashoffset: C * (1 - prog.value) } as any));

  const showCelebration = displayedAccuracy >= 80;
  const confettiMessage = showCelebration ? 'Congratulations! You did amazing! 🎉' : 'Great effort! Keep it up! 🎊';

  return (
    <View
      style={{
        alignSelf: 'center',
        width: '100%',
        maxWidth: 380,
        paddingVertical: 20,
        paddingHorizontal: 18,
        borderRadius: 24,
        backgroundColor: '#FFFFFF',
        shadowColor: '#000',
        shadowOpacity: 0.08,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: 8 },
        elevation: 6,
      }}
    >
      <View style={{ alignItems: 'center', marginBottom: 12 }}>
        <AnimatedConfettiEmoji isCelebrating={showCelebration} size={Platform.OS === 'web' ? 180 : 170} />
        <Text
          style={{
            marginTop: 6,
            fontWeight: '700',
            color: '#6B21A8',
            fontSize: 14,
            textAlign: 'center',
          }}
        >
          {confettiMessage}
        </Text>
      </View>
      <View style={{ alignItems: 'center', marginBottom: 12 }}>
        <View style={{ width: 150, height: 150, alignItems: 'center', justifyContent: 'center' }}>
          <Svg width={150} height={150}>
            <Circle cx={75} cy={75} r={R} stroke="#E5E7EB" strokeWidth={10} fill="none" />
            <AnimatedCircle
              cx={75} cy={75} r={R}
              stroke="#22C55E" strokeWidth={10} fill="none"
              strokeDasharray={`${C} ${C}`} animatedProps={props}
              strokeLinecap="round"
            />
          </Svg>
          <View style={{ position: 'absolute', alignItems: 'center' }}>
            <Text style={{ fontSize: 26, fontWeight: '900', color: '#111827' }}>
              {correct}/{total}
            </Text>
            <Text style={{ marginTop: 2, color: '#6B7280', fontWeight: '700', fontSize: 13 }}>
              {displayedAccuracy}%
            </Text>
          </View>
        </View>
        <SparkleBurst visible={pct >= 0.6} color={pct >= 0.8 ? '#F59E0B' : '#22C55E'} />
      </View>

      {/* Additional stats */}
      {(xpAwarded !== undefined || accuracy !== undefined) && (
        <View
          style={{
            backgroundColor: '#F9FAFB',
            borderRadius: 16,
            paddingVertical: 10,
            paddingHorizontal: 14,
            marginBottom: 10,
            width: '100%',
          }}
        >
          {xpAwarded !== undefined && (
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 6,
              }}
            >
              <Text style={{ color: '#6B7280', fontWeight: '600', fontSize: 13 }}>XP Earned</Text>
              <Text style={{ color: '#16A34A', fontWeight: '800', fontSize: 14 }}>+{xpAwarded} XP</Text>
            </View>
          )}
          {accuracy !== undefined && (
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <Text style={{ color: '#6B7280', fontWeight: '600', fontSize: 13 }}>Accuracy</Text>
              <Text style={{ color: '#111827', fontWeight: '800', fontSize: 14 }}>{displayedAccuracy}%</Text>
            </View>
          )}
        </View>
      )}

      <View style={{ alignItems: 'center', gap: 8, marginTop: 8, width: '100%' }}>
        {onContinue && (
          <TouchableOpacity
            onPress={onContinue}
            activeOpacity={0.9}
            style={{
              backgroundColor: '#22C55E',
              paddingHorizontal: 16,
              paddingVertical: 12,
              borderRadius: 999,
              alignSelf: 'stretch',
              alignItems: 'center',
            }}
          >
            <Text style={{ color: '#fff', fontWeight: '800', fontSize: 15 }}>Continue</Text>
          </TouchableOpacity>
        )}
        {onPlayAgain && (
          <TouchableOpacity
            onPress={onPlayAgain}
            activeOpacity={0.9}
            style={{
              backgroundColor: '#2563EB',
              paddingHorizontal: 16,
              paddingVertical: 12,
              borderRadius: 999,
              alignSelf: 'stretch',
              alignItems: 'center',
            }}
          >
            <Text style={{ color: '#fff', fontWeight: '800', fontSize: 15 }}>Play again</Text>
          </TouchableOpacity>
        )}
        {onHome && (
          <TouchableOpacity
            onPress={onHome}
            activeOpacity={0.9}
            style={{
              backgroundColor: '#E5E7EB',
              paddingHorizontal: 16,
              paddingVertical: 11,
              borderRadius: 999,
              alignSelf: 'stretch',
              alignItems: 'center',
            }}
          >
            <Text style={{ color: '#111827', fontWeight: '800', fontSize: 14 }}>Back to games</Text>
          </TouchableOpacity>
        )}
      </View>

      <ReflectionPrompt logTimestamp={logTimestamp} />
    </View>
  );
}

