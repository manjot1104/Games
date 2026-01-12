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

type BodyPart = 'head' | 'shoulder' | 'chest' | 'knee' | 'foot';

const BODY_PARTS: Record<BodyPart, { emoji: string; label: string; x: number; y: number }> = {
  head: { emoji: '👤', label: 'Head', x: 50, y: 20 },
  shoulder: { emoji: '💪', label: 'Shoulder', x: 35, y: 35 },
  chest: { emoji: '🫁', label: 'Chest', x: 50, y: 45 },
  knee: { emoji: '🦵', label: 'Knee', x: 45, y: 65 },
  foot: { emoji: '👣', label: 'Foot', x: 50, y: 80 },
};

const FollowTheBodyGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const [showInfo, setShowInfo] = useState(true);
  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [showBody, setShowBody] = useState(false);
  const [hasCopied, setHasCopied] = useState(false);
  const [phase, setPhase] = useState<'demo' | 'copy'>('demo');
  const [targetPart, setTargetPart] = useState<BodyPart | null>(null);
  const [userTapped, setUserTapped] = useState<BodyPart | null>(null);

  const demoScale = useRef(new Animated.Value(1)).current;
  const demoOpacity = useRef(new Animated.Value(1)).current;
  const userScale = useRef(new Animated.Value(1)).current;
  const userOpacity = useRef(new Animated.Value(1)).current;
  const demoAnimationRef = useRef<Animated.CompositeAnimation | null>(null);

  // Demo animation - character touches a body part
  const startDemo = useCallback(() => {
    if (done || !showBody || hasCopied) return;

    // Random body part
    const parts: BodyPart[] = ['head', 'shoulder', 'chest', 'knee', 'foot'];
    const part = parts[Math.floor(Math.random() * parts.length)];
    setTargetPart(part);

    setPhase('demo');

    const demo = Animated.sequence([
      Animated.parallel([
        Animated.timing(demoScale, {
          toValue: 1.3,
          duration: 500,
          useNativeDriver: true,
        }),
        Animated.timing(demoOpacity, {
          toValue: 0.8,
          duration: 500,
          useNativeDriver: true,
        }),
      ]),
      Animated.parallel([
        Animated.timing(demoScale, {
          toValue: 1,
          duration: 500,
          useNativeDriver: true,
        }),
        Animated.timing(demoOpacity, {
          toValue: 1,
          duration: 500,
          useNativeDriver: true,
        }),
      ]),
      Animated.delay(500),
    ]);

    demoAnimationRef.current = demo;
    demo.start(() => {
      // Demo complete, now user copies
      setPhase('copy');
      Speech.speak(`Character ne ${BODY_PARTS[part].label} touch kiya! Ab tum bhi ${BODY_PARTS[part].label} touch karo!`, { rate: 0.8 });
    });

    Speech.speak(`${BODY_PARTS[part].label} touch kar raha hai!`, { rate: 0.8 });
  }, [done, showBody, hasCopied, demoScale, demoOpacity]);

  const handleUserTap = useCallback((part: BodyPart) => {
    if (done || !showBody || hasCopied || phase !== 'copy' || targetPart === null) return;

    setUserTapped(part);

    if (part === targetPart) {
      // Correct!
      setHasCopied(true);
      setScore((s) => s + 1);
      
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      Speech.speak(`Perfect! ${BODY_PARTS[part].label} touch ho gaya!`, { rate: 0.9 });
      
      // Success animation
      Animated.sequence([
        Animated.parallel([
          Animated.timing(userScale, {
            toValue: 1.5,
            duration: 300,
            useNativeDriver: true,
          }),
          Animated.timing(userOpacity, {
            toValue: 0.9,
            duration: 300,
            useNativeDriver: true,
          }),
        ]),
        Animated.parallel([
          Animated.timing(userScale, {
            toValue: 1,
            duration: 300,
            useNativeDriver: true,
          }),
          Animated.timing(userOpacity, {
            toValue: 1,
            duration: 300,
            useNativeDriver: true,
          }),
        ]),
      ]).start();

      setTimeout(() => {
        if (round < TOTAL_ROUNDS) {
          setRound((r) => r + 1);
          setShowBody(false);
          setHasCopied(false);
          setPhase('demo');
          setTargetPart(null);
          setUserTapped(null);
          demoScale.setValue(1);
          demoOpacity.setValue(1);
          userScale.setValue(1);
          userOpacity.setValue(1);
        } else {
          endGame();
        }
      }, 1000);
    } else {
      // Wrong part
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      Speech.speak(`${BODY_PARTS[targetPart].label} touch karna hai! Dobara try karo!`, { rate: 0.8 });
      
      // Shake animation
      Animated.sequence([
        Animated.timing(userScale, {
          toValue: 0.9,
          duration: 100,
          useNativeDriver: true,
        }),
        Animated.timing(userScale, {
          toValue: 1.1,
          duration: 100,
          useNativeDriver: true,
        }),
        Animated.timing(userScale, {
          toValue: 1,
          duration: 100,
          useNativeDriver: true,
        }),
      ]).start();

      setTimeout(() => {
        setUserTapped(null);
      }, 500);
    }
  }, [done, showBody, hasCopied, phase, targetPart, round, userScale, userOpacity, demoScale, demoOpacity]);

  const showBodyObject = useCallback(() => {
    setShowBody(true);
    setHasCopied(false);
    setPhase('demo');
    setTargetPart(null);
    setUserTapped(null);
    demoScale.setValue(1);
    demoOpacity.setValue(1);
    userScale.setValue(1);
    userOpacity.setValue(1);
    
    // Start demo after a delay
    setTimeout(() => {
      startDemo();
    }, 500);
  }, [demoScale, demoOpacity, userScale, userOpacity, startDemo]);

  const startRound = useCallback(() => {
    if (done) return;
    setTimeout(() => {
      showBodyObject();
    }, 500);
  }, [done, showBodyObject]);

  const endGame = useCallback(async () => {
    const total = TOTAL_ROUNDS;
    const xp = score * 15;
    const accuracy = (score / total) * 100;

    setFinalStats({ correct: score, total, xp });
    setDone(true);
    setShowBody(false);

    if (demoAnimationRef.current) {
      demoAnimationRef.current.stop();
    }

    try {
      await logGameAndAward({
        type: 'tap',
        correct: score,
        total,
        accuracy,
        xpAwarded: xp,
        skillTags: ['imitation-skills', 'body-parts', 'following-instructions'],
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
      if (demoAnimationRef.current) {
        demoAnimationRef.current.stop();
      }
    };
  }, []);

  // Show info screen
  if (showInfo) {
    return (
      <GameInfoScreen
        title="Follow the Body"
        emoji="👥"
        description="Character jo touch kare wahi repeat! Demo dekh kar same body part touch karo!"
        skills={['Imitation skills', 'Body parts', 'Following instructions']}
        suitableFor="Children learning imitation skills and body part identification"
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
            setShowBody(false);
            setHasCopied(false);
            setPhase('demo');
            setTargetPart(null);
            setUserTapped(null);
            demoScale.setValue(1);
            demoOpacity.setValue(1);
            userScale.setValue(1);
            userOpacity.setValue(1);
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
        <Text style={styles.title}>Follow the Body</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • 👥 Score: {score}
        </Text>
        <Text style={styles.instruction}>
          {phase === 'demo' 
            ? 'Demo dekh rahe hain... Character ka wait karo!' 
            : targetPart 
              ? `Character ne ${BODY_PARTS[targetPart].label} touch kiya! Ab tum bhi touch karo!`
              : 'Get ready...'}
        </Text>
      </View>

      <View style={styles.gameArea}>
        {showBody && (
          <View style={styles.bodyContainer}>
            {/* Demo character (phase === 'demo') */}
            {phase === 'demo' && targetPart && (
              <Animated.View
                style={[
                  styles.demoCharacter,
                  {
                    transform: [{ scale: demoScale }],
                    opacity: demoOpacity,
                  },
                ]}
              >
                <Text style={styles.demoLabel}>DEMO</Text>
                <Text style={styles.characterEmoji}>👤</Text>
                <View
                  style={[
                    styles.touchingIndicator,
                    {
                      left: `${BODY_PARTS[targetPart].x}%`,
                      top: `${BODY_PARTS[targetPart].y}%`,
                      transform: [{ translateX: -20 }, { translateY: -20 }],
                    },
                  ]}
                >
                  <Text style={styles.touchingEmoji}>👆</Text>
                </View>
              </Animated.View>
            )}

            {/* User character (phase === 'copy') */}
            {phase === 'copy' && (
              <Animated.View
                style={[
                  styles.userCharacter,
                  {
                    transform: [{ scale: userScale }],
                    opacity: userOpacity,
                  },
                ]}
              >
                <Text style={styles.userLabel}>TUM</Text>
                <Text style={styles.characterEmoji}>👤</Text>
              </Animated.View>
            )}

            {/* Body parts - clickable when phase === 'copy' */}
            {phase === 'copy' && targetPart && (
              <>
                {Object.entries(BODY_PARTS).map(([partKey, partData]) => {
                  const part = partKey as BodyPart;
                  const isTarget = part === targetPart;
                  const isTapped = userTapped === part;
                  
                  return (
                    <TouchableOpacity
                      key={part}
                      activeOpacity={0.9}
                      onPress={() => handleUserTap(part)}
                      style={[
                        styles.bodyPartButton,
                        {
                          left: `${partData.x}%`,
                          top: `${partData.y}%`,
                          transform: [{ translateX: -40 }, { translateY: -40 }],
                          backgroundColor: isTarget ? '#3B82F6' : '#CBD5E1',
                          borderColor: isTapped ? (isTarget ? '#22C55E' : '#EF4444') : '#64748B',
                          borderWidth: isTapped ? 4 : 2,
                        },
                      ]}
                    >
                      <Text style={styles.bodyPartEmoji}>{partData.emoji}</Text>
                      <Text style={styles.bodyPartLabel}>{partData.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </>
            )}
          </View>
        )}

        {!showBody && (
          <View style={styles.waitingContainer}>
            <Text style={styles.waitingText}>Get ready...</Text>
          </View>
        )}
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Skills: Imitation skills • Body parts • Following instructions
        </Text>
        <Text style={styles.footerSubtext}>
          Watch the demo and copy which body part the character touches!
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
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  demoCharacter: {
    position: 'absolute',
    left: '25%',
    top: '30%',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  userCharacter: {
    position: 'absolute',
    left: '25%',
    top: '30%',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  demoLabel: {
    fontSize: 20,
    fontWeight: '800',
    color: '#3B82F6',
    marginBottom: 10,
  },
  userLabel: {
    fontSize: 20,
    fontWeight: '800',
    color: '#22C55E',
    marginBottom: 10,
  },
  characterEmoji: {
    fontSize: 80,
  },
  touchingIndicator: {
    position: 'absolute',
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 3,
  },
  touchingEmoji: {
    fontSize: 40,
  },
  bodyPartButton: {
    position: 'absolute',
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 4,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 3 },
    elevation: 5,
  },
  bodyPartEmoji: {
    fontSize: 40,
    marginBottom: 4,
  },
  bodyPartLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#fff',
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

export default FollowTheBodyGame;


