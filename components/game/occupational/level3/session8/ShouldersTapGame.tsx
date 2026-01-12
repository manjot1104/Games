import GameInfoScreen from '@/components/game/GameInfoScreen';
import ResultCard from '@/components/game/ResultCard';
import { logGameAndAward } from '@/utils/api';
import { cleanupSounds, stopAllSpeech } from '@/utils/soundPlayer';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import * as Speech from 'expo-speech';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    Animated,
    Dimensions,
    SafeAreaView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';

const TOTAL_ROUNDS = 10;
const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const LEFT_SHOULDER_X_PCT = 30;
const RIGHT_SHOULDER_X_PCT = 70;
const SHOULDERS_Y_PCT = 35;
const SHOULDER_SIZE = 80;

const ShouldersTapGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const [showInfo, setShowInfo] = useState(true);
  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [showShoulders, setShowShoulders] = useState(false);
  const [hasTapped, setHasTapped] = useState(false);
  const [targetShoulder, setTargetShoulder] = useState<'left' | 'right'>('left');

  const leftShoulderScale = useRef(new Animated.Value(1)).current;
  const rightShoulderScale = useRef(new Animated.Value(1)).current;
  const leftShoulderOpacity = useRef(new Animated.Value(1)).current;
  const rightShoulderOpacity = useRef(new Animated.Value(1)).current;
  const highlightAnimationRef = useRef<Animated.CompositeAnimation | null>(null);

  // Highlight target shoulder
  const startHighlight = useCallback(() => {
    if (done || !showShoulders || hasTapped) return;

    const targetScale = targetShoulder === 'left' ? leftShoulderScale : rightShoulderScale;
    const targetOpacity = targetShoulder === 'left' ? leftShoulderOpacity : rightShoulderOpacity;

    const pulse = Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(targetScale, {
            toValue: 1.3,
            duration: 500,
            useNativeDriver: true,
          }),
          Animated.timing(targetOpacity, {
            toValue: 0.7,
            duration: 500,
            useNativeDriver: true,
          }),
        ]),
        Animated.parallel([
          Animated.timing(targetScale, {
            toValue: 1,
            duration: 500,
            useNativeDriver: true,
          }),
          Animated.timing(targetOpacity, {
            toValue: 1,
            duration: 500,
            useNativeDriver: true,
          }),
        ]),
      ])
    );

    highlightAnimationRef.current = pulse;
    pulse.start();
  }, [done, showShoulders, hasTapped, targetShoulder, leftShoulderScale, rightShoulderScale, leftShoulderOpacity, rightShoulderOpacity]);

  const handleShoulderTap = useCallback((shoulder: 'left' | 'right') => {
    if (done || !showShoulders || hasTapped) return;

    if (shoulder === targetShoulder) {
      // Correct!
      setHasTapped(true);
      setScore((s) => s + 1);
      
      if (highlightAnimationRef.current) {
        highlightAnimationRef.current.stop();
      }
      
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      Speech.speak('Shoulder touch ho gaya!', { rate: 0.9 });
      
      const targetScale = shoulder === 'left' ? leftShoulderScale : rightShoulderScale;
      const targetOpacity = shoulder === 'left' ? leftShoulderOpacity : rightShoulderOpacity;
      
      // Success animation
      Animated.sequence([
        Animated.parallel([
          Animated.timing(targetScale, {
            toValue: 1.5,
            duration: 300,
            useNativeDriver: true,
          }),
          Animated.timing(targetOpacity, {
            toValue: 0.8,
            duration: 300,
            useNativeDriver: true,
          }),
        ]),
        Animated.parallel([
          Animated.timing(targetScale, {
            toValue: 1,
            duration: 300,
            useNativeDriver: true,
          }),
          Animated.timing(targetOpacity, {
            toValue: 1,
            duration: 300,
            useNativeDriver: true,
          }),
        ]),
      ]).start();

      setTimeout(() => {
        if (round < TOTAL_ROUNDS) {
          setRound((r) => r + 1);
          setShowShoulders(false);
          setHasTapped(false);
          leftShoulderScale.setValue(1);
          rightShoulderScale.setValue(1);
          leftShoulderOpacity.setValue(1);
          rightShoulderOpacity.setValue(1);
        } else {
          endGame();
        }
      }, 1000);
    } else {
      // Wrong shoulder
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
      Speech.speak(`${targetShoulder === 'left' ? 'Left' : 'Right'} shoulder touch karna hai!`, { rate: 0.8 });
      
      const wrongScale = shoulder === 'left' ? leftShoulderScale : rightShoulderScale;
      
      // Shake animation
      Animated.sequence([
        Animated.timing(wrongScale, {
          toValue: 0.9,
          duration: 100,
          useNativeDriver: true,
        }),
        Animated.timing(wrongScale, {
          toValue: 1.1,
          duration: 100,
          useNativeDriver: true,
        }),
        Animated.timing(wrongScale, {
          toValue: 1,
          duration: 100,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [done, showShoulders, hasTapped, targetShoulder, round, leftShoulderScale, rightShoulderScale, leftShoulderOpacity, rightShoulderOpacity]);

  const showShouldersObject = useCallback(() => {
    // Random target shoulder
    const shoulder: 'left' | 'right' = Math.random() > 0.5 ? 'left' : 'right';
    setTargetShoulder(shoulder);
    
    setShowShoulders(true);
    setHasTapped(false);
    leftShoulderScale.setValue(1);
    rightShoulderScale.setValue(1);
    leftShoulderOpacity.setValue(1);
    rightShoulderOpacity.setValue(1);
    
    // Start highlighting after a delay
    setTimeout(() => {
      startHighlight();
      const instruction = shoulder === 'left' 
        ? 'Left shoulder highlight hai! Left shoulder touch karo!' 
        : 'Right shoulder highlight hai! Right shoulder touch karo!';
      Speech.speak(instruction, { rate: 0.8 });
    }, 500);
  }, [leftShoulderScale, rightShoulderScale, leftShoulderOpacity, rightShoulderOpacity, startHighlight]);

  const startRound = useCallback(() => {
    if (done) return;
    setTimeout(() => {
      showShouldersObject();
    }, 500);
  }, [done, showShouldersObject]);

  const endGame = useCallback(async () => {
    const total = TOTAL_ROUNDS;
    const xp = score * 15;
    const accuracy = (score / total) * 100;

    setFinalStats({ correct: score, total, xp });
    setDone(true);
    setShowShoulders(false);

    if (highlightAnimationRef.current) {
      highlightAnimationRef.current.stop();
    }

    try {
      await logGameAndAward({
        type: 'tap',
        correct: score,
        total,
        accuracy,
        xpAwarded: xp,
        skillTags: ['upper-body-coordination', 'shoulder-identification'],
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
        Speech.stop();
      } catch (e) {
        // Ignore errors
      }
      cleanupSounds();
      if (highlightAnimationRef.current) {
        highlightAnimationRef.current.stop();
      }
    };
  }, []);

  // Show info screen
  if (showInfo) {
    return (
      <GameInfoScreen
        title="Shoulders Tap"
        emoji="💪"
        description="Shoulders touch karna! Highlighted shoulder ko touch karo!"
        skills={['Upper body coordination', 'Shoulder identification']}
        suitableFor="Children learning upper body coordination and shoulder identification"
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
            setShowShoulders(false);
            setHasTapped(false);
            leftShoulderScale.setValue(1);
            rightShoulderScale.setValue(1);
            leftShoulderOpacity.setValue(1);
            rightShoulderOpacity.setValue(1);
          }}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
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
        <Text style={styles.title}>Shoulders Tap</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • 💪 Score: {score}
        </Text>
        <Text style={styles.instruction}>
          {targetShoulder === 'left' ? 'Left shoulder touch karo!' : 'Right shoulder touch karo!'}
        </Text>
      </View>

      <View style={styles.gameArea}>
        {showShoulders && (
          <View style={styles.bodyContainer}>
            {/* Body outline */}
            <View style={styles.bodyOutline}>
              {/* Head */}
              <View style={styles.head}>
                <Text style={styles.headEmoji}>👤</Text>
              </View>
              
              {/* Left Shoulder */}
              <TouchableOpacity
                activeOpacity={0.9}
                onPress={() => handleShoulderTap('left')}
                style={[
                  styles.shoulderContainer,
                  {
                    left: `${LEFT_SHOULDER_X_PCT}%`,
                    top: `${SHOULDERS_Y_PCT}%`,
                    transform: [{ translateX: -SHOULDER_SIZE / 2 }, { translateY: -SHOULDER_SIZE / 2 }],
                  },
                ]}
              >
                <Animated.View
                  style={[
                    styles.shoulder,
                    {
                      transform: [{ scale: leftShoulderScale }],
                      opacity: leftShoulderOpacity,
                      backgroundColor: targetShoulder === 'left' ? '#3B82F6' : '#CBD5E1',
                    },
                  ]}
                >
                  <Text style={styles.shoulderLabel}>L</Text>
                </Animated.View>
              </TouchableOpacity>

              {/* Right Shoulder */}
              <TouchableOpacity
                activeOpacity={0.9}
                onPress={() => handleShoulderTap('right')}
                style={[
                  styles.shoulderContainer,
                  {
                    left: `${RIGHT_SHOULDER_X_PCT}%`,
                    top: `${SHOULDERS_Y_PCT}%`,
                    transform: [{ translateX: -SHOULDER_SIZE / 2 }, { translateY: -SHOULDER_SIZE / 2 }],
                  },
                ]}
              >
                <Animated.View
                  style={[
                    styles.shoulder,
                    {
                      transform: [{ scale: rightShoulderScale }],
                      opacity: rightShoulderOpacity,
                      backgroundColor: targetShoulder === 'right' ? '#3B82F6' : '#CBD5E1',
                    },
                  ]}
                >
                  <Text style={styles.shoulderLabel}>R</Text>
                </Animated.View>
              </TouchableOpacity>

              {/* Torso */}
              <View style={styles.torso} />
            </View>
          </View>
        )}

        {!showShoulders && (
          <View style={styles.waitingContainer}>
            <Text style={styles.waitingText}>Get ready...</Text>
          </View>
        )}
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Skills: Upper body coordination • Shoulder identification
        </Text>
        <Text style={styles.footerSubtext}>
          Touch the highlighted shoulder!
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
  },
  gameArea: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
    marginVertical: 40,
  },
  bodyContainer: {
    width: '100%',
    height: '100%',
    justifyContent: 'flex-start',
    alignItems: 'center',
    position: 'relative',
  },
  bodyOutline: {
    position: 'absolute',
    top: '20%',
    width: '100%',
    alignItems: 'center',
  },
  head: {
    width: 80,
    height: 80,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
    opacity: 0.5,
  },
  headEmoji: {
    fontSize: 60,
  },
  shoulderContainer: {
    position: 'absolute',
    width: SHOULDER_SIZE,
    height: SHOULDER_SIZE,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 3,
  },
  shoulder: {
    width: SHOULDER_SIZE,
    height: SHOULDER_SIZE,
    borderRadius: SHOULDER_SIZE / 2,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: '#1E40AF',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 3 },
    elevation: 5,
  },
  shoulderLabel: {
    fontSize: 24,
    fontWeight: '800',
    color: '#fff',
  },
  torso: {
    width: 100,
    height: 150,
    backgroundColor: '#CBD5E1',
    borderRadius: 50,
    marginTop: 80,
    opacity: 0.3,
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

export default ShouldersTapGame;


