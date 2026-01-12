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
const HEAD_X_PCT = 50;
const HEAD_Y_PCT = 25;
const HEAD_SIZE = 100;

const TouchHeadGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const [showInfo, setShowInfo] = useState(true);
  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [showHead, setShowHead] = useState(false);
  const [hasTapped, setHasTapped] = useState(false);
  const [isHighlighted, setIsHighlighted] = useState(false);

  const headScale = useRef(new Animated.Value(1)).current;
  const headOpacity = useRef(new Animated.Value(1)).current;
  const glowScale = useRef(new Animated.Value(1)).current;
  const glowOpacity = useRef(new Animated.Value(0.5)).current;
  const highlightAnimationRef = useRef<Animated.CompositeAnimation | null>(null);

  // Highlight animation
  const startHighlight = useCallback(() => {
    if (done || !showHead || hasTapped) return;

    setIsHighlighted(true);

    const pulse = Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(glowScale, {
            toValue: 1.3,
            duration: 600,
            useNativeDriver: true,
          }),
          Animated.timing(glowOpacity, {
            toValue: 0.8,
            duration: 600,
            useNativeDriver: true,
          }),
          Animated.timing(headScale, {
            toValue: 1.1,
            duration: 600,
            useNativeDriver: true,
          }),
        ]),
        Animated.parallel([
          Animated.timing(glowScale, {
            toValue: 1,
            duration: 600,
            useNativeDriver: true,
          }),
          Animated.timing(glowOpacity, {
            toValue: 0.5,
            duration: 600,
            useNativeDriver: true,
          }),
          Animated.timing(headScale, {
            toValue: 1,
            duration: 600,
            useNativeDriver: true,
          }),
        ]),
      ])
    );

    highlightAnimationRef.current = pulse;
    pulse.start();
  }, [done, showHead, hasTapped, glowScale, glowOpacity, headScale]);

  const handleHeadTap = useCallback(() => {
    if (done || !showHead || hasTapped || !isHighlighted) return;

    setHasTapped(true);
    setScore((s) => s + 1);
    
    if (highlightAnimationRef.current) {
      highlightAnimationRef.current.stop();
    }
    
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    Speech.speak('Head touch ho gaya!', { rate: 0.9 });
    
    // Success animation
    Animated.sequence([
      Animated.parallel([
        Animated.timing(headScale, {
          toValue: 1.5,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.timing(glowOpacity, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
      ]),
      Animated.parallel([
        Animated.timing(headScale, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.timing(glowOpacity, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }),
      ]),
    ]).start();

    setTimeout(() => {
      if (round < TOTAL_ROUNDS) {
        setRound((r) => r + 1);
        setShowHead(false);
        setHasTapped(false);
        setIsHighlighted(false);
        headScale.setValue(1);
        headOpacity.setValue(1);
        glowScale.setValue(1);
        glowOpacity.setValue(0.5);
      } else {
        endGame();
      }
    }, 1000);
  }, [done, showHead, hasTapped, isHighlighted, round, headScale, glowOpacity]);

  const showHeadObject = useCallback(() => {
    setShowHead(true);
    setHasTapped(false);
    setIsHighlighted(false);
    headScale.setValue(1);
    headOpacity.setValue(1);
    glowScale.setValue(1);
    glowOpacity.setValue(0);
    
    // Start highlighting after a delay
    setTimeout(() => {
      startHighlight();
      Speech.speak('Head highlight ho raha hai! Head ko touch karo!', { rate: 0.8 });
    }, 500);
  }, [headScale, headOpacity, glowScale, glowOpacity, startHighlight]);

  const startRound = useCallback(() => {
    if (done) return;
    setTimeout(() => {
      showHeadObject();
    }, 500);
  }, [done, showHeadObject]);

  const endGame = useCallback(async () => {
    const total = TOTAL_ROUNDS;
    const xp = score * 15;
    const accuracy = (score / total) * 100;

    setFinalStats({ correct: score, total, xp });
    setDone(true);
    setShowHead(false);

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
        skillTags: ['body-part-awareness', 'head-identification'],
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
        title="Touch Head"
        emoji="👤"
        description="Head highlight hota hai! Head ko touch karo jab woh highlight ho!"
        skills={['Body part awareness', 'Head identification']}
        suitableFor="Children learning body part awareness and identification"
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
            setShowHead(false);
            setHasTapped(false);
            setIsHighlighted(false);
            headScale.setValue(1);
            headOpacity.setValue(1);
            glowScale.setValue(1);
            glowOpacity.setValue(0.5);
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
        <Text style={styles.title}>Touch Head</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • 👤 Score: {score}
        </Text>
        <Text style={styles.instruction}>
          {isHighlighted ? 'Head highlight hai! Touch karo!' : 'Head highlight hone ka wait karo...'}
        </Text>
      </View>

      <View style={styles.gameArea}>
        {showHead && (
          <TouchableOpacity
            activeOpacity={0.9}
            onPress={handleHeadTap}
            style={styles.tapArea}
          >
            {/* Body outline */}
            <View style={styles.bodyContainer}>
              {/* Head */}
              <Animated.View
                style={[
                  styles.headContainer,
                  {
                    left: `${HEAD_X_PCT}%`,
                    top: `${HEAD_Y_PCT}%`,
                    transform: [
                      { translateX: -HEAD_SIZE / 2 },
                      { translateY: -HEAD_SIZE / 2 },
                      { scale: headScale },
                    ],
                    opacity: headOpacity,
                  },
                ]}
              >
                {/* Glow effect when highlighted */}
                {isHighlighted && (
                  <Animated.View
                    style={[
                      styles.glowEffect,
                      {
                        transform: [{ scale: glowScale }],
                        opacity: glowOpacity,
                      },
                    ]}
                  />
                )}
                <Text style={styles.headEmoji}>👤</Text>
              </Animated.View>

              {/* Body (simple representation) */}
              <View style={styles.bodyOutline}>
                <View style={styles.torso} />
                <View style={styles.arms} />
                <View style={styles.legs} />
              </View>
            </View>
          </TouchableOpacity>
        )}

        {!showHead && (
          <View style={styles.waitingContainer}>
            <Text style={styles.waitingText}>Get ready...</Text>
          </View>
        )}
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Skills: Body part awareness • Head identification
        </Text>
        <Text style={styles.footerSubtext}>
          Touch the head when it's highlighted!
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
  tapArea: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  bodyContainer: {
    width: '100%',
    height: '100%',
    justifyContent: 'flex-start',
    alignItems: 'center',
    position: 'relative',
  },
  headContainer: {
    position: 'absolute',
    width: HEAD_SIZE,
    height: HEAD_SIZE,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 3,
  },
  glowEffect: {
    position: 'absolute',
    width: HEAD_SIZE * 1.5,
    height: HEAD_SIZE * 1.5,
    borderRadius: HEAD_SIZE * 0.75,
    backgroundColor: '#3B82F6',
    zIndex: 1,
  },
  headEmoji: {
    fontSize: 80,
    zIndex: 2,
  },
  bodyOutline: {
    position: 'absolute',
    top: `${HEAD_Y_PCT + 15}%`,
    alignItems: 'center',
    opacity: 0.3,
  },
  torso: {
    width: 80,
    height: 120,
    backgroundColor: '#CBD5E1',
    borderRadius: 40,
    marginBottom: 10,
  },
  arms: {
    width: 180,
    height: 20,
    backgroundColor: '#CBD5E1',
    borderRadius: 10,
    marginBottom: 10,
  },
  legs: {
    width: 60,
    height: 100,
    backgroundColor: '#CBD5E1',
    borderRadius: 30,
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

export default TouchHeadGame;


