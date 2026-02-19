import GameInfoScreen from '@/components/game/GameInfoScreen';
import ResultCard from '@/components/game/ResultCard';
import { logGameAndAward } from '@/utils/api';
import { cleanupSounds, stopAllSpeech } from '@/utils/soundPlayer';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { speak as speakTTS, DEFAULT_TTS_RATE, stopTTS } from '@/utils/tts';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    Animated,
    Dimensions,
    PanResponder,
    SafeAreaView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';

const TOTAL_ROUNDS = 10;
const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const FAN_CENTER_X_PCT = 50;
const FAN_CENTER_Y_PCT = 50;
const CIRCLE_RADIUS_PCT = 30;
const MIN_CIRCLE_PROGRESS = 0.8; // Must complete 80% of circle

const FanMotionGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const [showInfo, setShowInfo] = useState(true);
  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [showFan, setShowFan] = useState(false);
  const [hasSwung, setHasSwung] = useState(false);
  const [progress, setProgress] = useState(0);

  const fanRotation = useRef(new Animated.Value(0)).current;
  const fanScale = useRef(new Animated.Value(1)).current;
  const lastAngle = useRef<number | null>(null);
  const angleProgress = useRef(0);
  const centerX = useRef(0);
  const centerY = useRef(0);
  const screenWidth = useRef(SCREEN_WIDTH);
  const screenHeight = useRef(SCREEN_HEIGHT);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        if (done || !showFan || hasSwung) return;
        const touchX = evt.nativeEvent.pageX;
        const touchY = evt.nativeEvent.pageY;
        
        // Calculate center in pixels
        centerX.current = (screenWidth.current * FAN_CENTER_X_PCT) / 100;
        centerY.current = (screenHeight.current * FAN_CENTER_Y_PCT) / 100;
        
        // Calculate initial angle
        const dx = touchX - centerX.current;
        const dy = touchY - centerY.current;
        lastAngle.current = Math.atan2(dy, dx);
        angleProgress.current = 0;
        setProgress(0);
      },
      onPanResponderMove: (evt) => {
        if (done || !showFan || hasSwung || lastAngle.current === null) return;
        
        const touchX = evt.nativeEvent.pageX;
        const touchY = evt.nativeEvent.pageY;
        
        // Calculate current angle
        const dx = touchX - centerX.current;
        const dy = touchY - centerY.current;
        const currentAngle = Math.atan2(dy, dx);
        
        // Calculate angle difference
        let angleDiff = currentAngle - lastAngle.current;
        
        // Normalize to -PI to PI
        if (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
        if (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;
        
        // Accumulate progress (only positive movement)
        if (Math.abs(angleDiff) > 0.1) {
          angleProgress.current += Math.abs(angleDiff);
          const newProgress = Math.min(1, angleProgress.current / (2 * Math.PI));
          setProgress(newProgress);
          
          // Update fan rotation
          fanRotation.setValue(angleProgress.current * (180 / Math.PI));
          
          lastAngle.current = currentAngle;
          
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        }
        
        // Check if circle completed
        if (newProgress >= MIN_CIRCLE_PROGRESS) {
          handleSuccess();
        }
      },
      onPanResponderRelease: () => {
        if (progress < MIN_CIRCLE_PROGRESS) {
          // Not enough progress
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
          speakTTS('Zada circle banaye! Complete circle swing karo!', 0.8 );
          
          // Reset
          Animated.spring(fanRotation, {
            toValue: 0,
            damping: 10,
            stiffness: 100,
            useNativeDriver: true,
          }).start();
          angleProgress.current = 0;
          setProgress(0);
          lastAngle.current = null;
        }
      },
    })
  ).current;

  const showFanObject = useCallback(() => {
    setShowFan(true);
    setHasSwung(false);
    setProgress(0);
    angleProgress.current = 0;
    lastAngle.current = null;
    fanRotation.setValue(0);
    fanScale.setValue(1);
    
    Animated.spring(fanScale, {
      toValue: 1,
      tension: 50,
      friction: 7,
      useNativeDriver: true,
    }).start();

    speakTTS('Fan ko circular swing karao! Complete circle banaye!', 0.8 );
  }, [fanScale, fanRotation]);

  const handleSuccess = useCallback(() => {
    setHasSwung(true);
    setScore((s) => s + 1);
    
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    speakTTS('Perfect circular swing!', 0.9 );
    
    // Success animation
    Animated.sequence([
      Animated.parallel([
        Animated.timing(fanScale, {
          toValue: 1.3,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(fanRotation, {
          toValue: (angleProgress.current / (2 * Math.PI)) * 360 + 360,
          duration: 300,
          useNativeDriver: true,
        }),
      ]),
      Animated.timing(fanScale, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start();

    setTimeout(() => {
      if (round < TOTAL_ROUNDS) {
        setRound((r) => r + 1);
        setShowFan(false);
        setHasSwung(false);
        setProgress(0);
        angleProgress.current = 0;
        lastAngle.current = null;
        fanRotation.setValue(0);
        fanScale.setValue(1);
      } else {
        endGame();
      }
    }, 1000);
  }, [round, fanRotation, fanScale]);

  const startRound = useCallback(() => {
    if (done) return;
    setTimeout(() => {
      showFanObject();
    }, 500);
  }, [done, showFanObject]);

  const endGame = useCallback(async () => {
    const total = TOTAL_ROUNDS;
    const xp = score * 15;
    const accuracy = (score / total) * 100;

    setFinalStats({ correct: score, total, xp });
    setDone(true);
    setShowFan(false);

    try {
      await logGameAndAward({
        type: 'fan-motion',
        correct: score,
        total,
        accuracy,
        xpAwarded: xp,
        skillTags: ['wrist-flexibility', 'circular-motion'],
      });
      router.setParams({ refreshStats: Date.now().toString() });
    } catch (error) {
      console.error('Failed to log game:', error);
    }
  }, [score, router]);

  useEffect(() => {
    if (!showInfo && !done && round <= TOTAL_ROUNDS) {
      startRound();
    }
  }, [showInfo, round, done, startRound]);

  useEffect(() => {
    return () => {
      try {
        stopTTS();
      } catch (e) {
        // Ignore errors
      }
      cleanupSounds();
    };
  }, []);

  // Show info screen
  if (showInfo) {
    return (
      <GameInfoScreen
        title="Fan Motion"
        emoji="🌀"
        description="Circular swing gesture! Fan ko complete circle mein swing karao!"
        skills={['Wrist flexibility', 'Circular motion']}
        suitableFor="Children learning wrist flexibility and circular gestures"
        onStart={() => {
          setShowInfo(false);
        }}
        onBack={() => {
          stopAllSpeech();
          cleanupSounds();
          onBack?.();
        }}
      />
    );
  }

  // Result screen
  if (done && finalStats) {
    return (
      <SafeAreaView style={styles.container}>
        <ResultCard
          correct={finalStats.correct}
          total={finalStats.total}
          xpAwarded={finalStats.xp}
          onHome={() => {
            stopAllSpeech();
            cleanupSounds();
            onBack?.();
          }}
          onPlayAgain={() => {
            setRound(1);
            setScore(0);
            setDone(false);
            setFinalStats(null);
            setShowFan(false);
            setHasSwung(false);
            setProgress(0);
            angleProgress.current = 0;
            lastAngle.current = null;
            fanRotation.setValue(0);
            fanScale.setValue(1);
          }}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} {...panResponder.panHandlers}>
      <TouchableOpacity
        style={styles.backButton}
        onPress={() => {
          stopAllSpeech();
          cleanupSounds();
          onBack?.();
        }}
      >
        <Text style={styles.backButtonText}>← Back</Text>
      </TouchableOpacity>

      <View style={styles.header}>
        <Text style={styles.title}>Fan Motion</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • 🌀 Score: {score}
        </Text>
        <Text style={styles.instruction}>
          Fan ko circular swing karao! Complete circle banaye!
        </Text>
        {progress > 0 && (
          <Text style={styles.progressIndicator}>
            Circle: {Math.round(progress * 100)}%
          </Text>
        )}
      </View>

      <View 
        style={styles.gameArea}
        onLayout={(e) => {
          screenWidth.current = e.nativeEvent.layout.width;
          screenHeight.current = e.nativeEvent.layout.height;
        }}
      >
        {showFan && (
          <View style={styles.fanContainer}>
            {/* Guide circle */}
            <View style={[
              styles.guideCircle,
              {
                left: `${FAN_CENTER_X_PCT}%`,
                top: `${FAN_CENTER_Y_PCT}%`,
                width: (screenWidth.current * CIRCLE_RADIUS_PCT * 2) / 100,
                height: (screenWidth.current * CIRCLE_RADIUS_PCT * 2) / 100,
                borderRadius: (screenWidth.current * CIRCLE_RADIUS_PCT) / 100,
                marginLeft: -(screenWidth.current * CIRCLE_RADIUS_PCT) / 100,
                marginTop: -(screenWidth.current * CIRCLE_RADIUS_PCT) / 100,
              },
            ]} />

            <Animated.View
              style={[
                styles.fan,
                {
                  left: `${FAN_CENTER_X_PCT}%`,
                  top: `${FAN_CENTER_Y_PCT}%`,
                  transform: [
                    { translateX: -40 },
                    { translateY: -40 },
                    { rotate: fanRotation.interpolate({
                      inputRange: [0, 360],
                      outputRange: ['0deg', '360deg'],
                    }) },
                    { scale: fanScale },
                  ],
                },
              ]}
            >
              <Text style={styles.fanEmoji}>🌀</Text>
            </Animated.View>
          </View>
        )}

        {!showFan && (
          <View style={styles.waitingContainer}>
            <Text style={styles.waitingText}>Get ready...</Text>
          </View>
        )}
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Skills: Wrist flexibility • Circular motion
        </Text>
        <Text style={styles.footerSubtext}>
          Draw a complete circle around the fan to swing it!
        </Text>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F0F9FF',
  },
  backButton: {
    position: 'absolute',
    top: 50,
    left: 16,
    zIndex: 10,
    backgroundColor: '#0F172A',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  backButtonText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
  },
  header: {
    marginTop: 80,
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 18,
    color: '#475569',
    marginBottom: 12,
  },
  instruction: {
    fontSize: 16,
    color: '#3B82F6',
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 8,
  },
  progressIndicator: {
    fontSize: 20,
    color: '#3B82F6',
    fontWeight: '800',
  },
  gameArea: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
    marginVertical: 40,
  },
  fanContainer: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  guideCircle: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: 'rgba(59, 130, 246, 0.3)',
    borderStyle: 'dashed',
  },
  fan: {
    position: 'absolute',
    width: 80,
    height: 80,
    justifyContent: 'center',
    alignItems: 'center',
  },
  fanEmoji: {
    fontSize: 70,
  },
  waitingContainer: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  waitingText: {
    fontSize: 20,
    color: '#64748B',
    fontWeight: '600',
  },
  footer: {
    padding: 20,
    alignItems: 'center',
  },
  footerText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 4,
    textAlign: 'center',
  },
  footerSubtext: {
    fontSize: 12,
    color: '#64748B',
    textAlign: 'center',
  },
});

export default FanMotionGame;

