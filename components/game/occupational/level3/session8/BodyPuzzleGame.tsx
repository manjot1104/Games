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
const MATCH_TOLERANCE = 50; // pixels

type BodyPart = 'head' | 'torso' | 'arm' | 'leg';

type BodyPartData = {
  id: BodyPart;
  emoji: string;
  targetX: number; // % of screen
  targetY: number; // % of screen
  startX: number;
  startY: number;
};

const BODY_PARTS: Record<BodyPart, BodyPartData> = {
  head: {
    id: 'head',
    emoji: '👤',
    targetX: 50,
    targetY: 20,
    startX: 20,
    startY: 70,
  },
  torso: {
    id: 'torso',
    emoji: '🟦',
    targetX: 50,
    targetY: 40,
    startX: 80,
    startY: 70,
  },
  arm: {
    id: 'arm',
    emoji: '💪',
    targetX: 30,
    targetY: 35,
    startX: 20,
    startY: 80,
  },
  leg: {
    id: 'leg',
    emoji: '🦵',
    targetX: 50,
    targetY: 60,
    startX: 80,
    startY: 80,
  },
};

const BodyPuzzleGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const [showInfo, setShowInfo] = useState(true);
  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [showPuzzle, setShowPuzzle] = useState(false);
  const [placedParts, setPlacedParts] = useState<Set<BodyPart>>(new Set());
  const [draggingPart, setDraggingPart] = useState<BodyPart | null>(null);
  const [currentPart, setCurrentPart] = useState<BodyPart>('head');

  const partPositions = useRef<Record<BodyPart, { x: Animated.Value; y: Animated.Value; scale: Animated.Value }>>({
    head: {
      x: new Animated.Value(BODY_PARTS.head.startX),
      y: new Animated.Value(BODY_PARTS.head.startY),
      scale: new Animated.Value(1),
    },
    torso: {
      x: new Animated.Value(BODY_PARTS.torso.startX),
      y: new Animated.Value(BODY_PARTS.torso.startY),
      scale: new Animated.Value(1),
    },
    arm: {
      x: new Animated.Value(BODY_PARTS.arm.startX),
      y: new Animated.Value(BODY_PARTS.arm.startY),
      scale: new Animated.Value(1),
    },
    leg: {
      x: new Animated.Value(BODY_PARTS.leg.startX),
      y: new Animated.Value(BODY_PARTS.leg.startY),
      scale: new Animated.Value(1),
    },
  });

  const screenWidth = useRef(SCREEN_WIDTH);
  const screenHeight = useRef(SCREEN_HEIGHT);

  const headPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => !placedParts.has('head') && !done,
      onMoveShouldSetPanResponder: () => !placedParts.has('head') && !done,
      onPanResponderGrant: () => {
        if (placedParts.has('head') || done) return;
        setDraggingPart('head');
        partPositions.current.head.scale.setValue(1.2);
      },
      onPanResponderMove: (evt) => {
        if (placedParts.has('head') || done || draggingPart !== 'head') return;
        const newXPct = (evt.nativeEvent.pageX / screenWidth.current) * 100;
        const newYPct = (evt.nativeEvent.pageY / screenHeight.current) * 100;
        partPositions.current.head.x.setValue(Math.max(5, Math.min(95, newXPct)));
        partPositions.current.head.y.setValue(Math.max(10, Math.min(90, newYPct)));
      },
      onPanResponderRelease: (evt) => handlePartRelease('head', evt),
    })
  ).current;

  const torsoPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => !placedParts.has('torso') && !done,
      onMoveShouldSetPanResponder: () => !placedParts.has('torso') && !done,
      onPanResponderGrant: () => {
        if (placedParts.has('torso') || done) return;
        setDraggingPart('torso');
        partPositions.current.torso.scale.setValue(1.2);
      },
      onPanResponderMove: (evt) => {
        if (placedParts.has('torso') || done || draggingPart !== 'torso') return;
        const newXPct = (evt.nativeEvent.pageX / screenWidth.current) * 100;
        const newYPct = (evt.nativeEvent.pageY / screenHeight.current) * 100;
        partPositions.current.torso.x.setValue(Math.max(5, Math.min(95, newXPct)));
        partPositions.current.torso.y.setValue(Math.max(10, Math.min(90, newYPct)));
      },
      onPanResponderRelease: (evt) => handlePartRelease('torso', evt),
    })
  ).current;

  const armPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => !placedParts.has('arm') && !done,
      onMoveShouldSetPanResponder: () => !placedParts.has('arm') && !done,
      onPanResponderGrant: () => {
        if (placedParts.has('arm') || done) return;
        setDraggingPart('arm');
        partPositions.current.arm.scale.setValue(1.2);
      },
      onPanResponderMove: (evt) => {
        if (placedParts.has('arm') || done || draggingPart !== 'arm') return;
        const newXPct = (evt.nativeEvent.pageX / screenWidth.current) * 100;
        const newYPct = (evt.nativeEvent.pageY / screenHeight.current) * 100;
        partPositions.current.arm.x.setValue(Math.max(5, Math.min(95, newXPct)));
        partPositions.current.arm.y.setValue(Math.max(10, Math.min(90, newYPct)));
      },
      onPanResponderRelease: (evt) => handlePartRelease('arm', evt),
    })
  ).current;

  const legPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => !placedParts.has('leg') && !done,
      onMoveShouldSetPanResponder: () => !placedParts.has('leg') && !done,
      onPanResponderGrant: () => {
        if (placedParts.has('leg') || done) return;
        setDraggingPart('leg');
        partPositions.current.leg.scale.setValue(1.2);
      },
      onPanResponderMove: (evt) => {
        if (placedParts.has('leg') || done || draggingPart !== 'leg') return;
        const newXPct = (evt.nativeEvent.pageX / screenWidth.current) * 100;
        const newYPct = (evt.nativeEvent.pageY / screenHeight.current) * 100;
        partPositions.current.leg.x.setValue(Math.max(5, Math.min(95, newXPct)));
        partPositions.current.leg.y.setValue(Math.max(10, Math.min(90, newYPct)));
      },
      onPanResponderRelease: (evt) => handlePartRelease('leg', evt),
    })
  ).current;

  const endGame = useCallback(async () => {
    const total = TOTAL_ROUNDS;
    const xp = score * 15;
    const accuracy = (score / total) * 100;

    setFinalStats({ correct: score, total, xp });
    setDone(true);
    setShowPuzzle(false);

    try {
      await logGameAndAward({
        type: 'match',
        correct: score,
        total,
        accuracy,
        xpAwarded: xp,
        skillTags: ['spatial-understanding', 'body-parts', 'puzzle-solving'],
      });
      router.setParams({ refreshStats: Date.now().toString() });
    } catch (error) {
      console.error('Failed to log game:', error);
    }
  }, [score, router]);

  const handlePartRelease = useCallback((part: BodyPart, evt: any) => {
    if (done) return;
    
    setPlacedParts((currentPlaced) => {
      if (currentPlaced.has(part)) return currentPlaced;
      
      const currentXPct = evt.nativeEvent.pageX / screenWidth.current * 100;
      const currentYPct = evt.nativeEvent.pageY / screenHeight.current * 100;
      const target = BODY_PARTS[part];
      
      const distance = Math.sqrt(
        Math.pow((currentXPct - target.targetX) * screenWidth.current / 100, 2) +
        Math.pow((currentYPct - target.targetY) * screenHeight.current / 100, 2)
      );
      
      if (distance <= MATCH_TOLERANCE) {
        // Correct placement!
        const newPlaced = new Set([...currentPlaced, part]);
        setDraggingPart(null);
        
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        speakTTS(`${part} sahi jagah lag gaya!`, 0.9 );
        
        // Snap to target
        Animated.parallel([
          Animated.spring(partPositions.current[part].x, {
            toValue: target.targetX,
            damping: 10,
            stiffness: 200,
            useNativeDriver: false,
          }),
          Animated.spring(partPositions.current[part].y, {
            toValue: target.targetY,
            damping: 10,
            stiffness: 200,
            useNativeDriver: false,
          }),
          Animated.sequence([
            Animated.timing(partPositions.current[part].scale, {
              toValue: 1.3,
              duration: 200,
              useNativeDriver: true,
            }),
            Animated.timing(partPositions.current[part].scale, {
              toValue: 1,
              duration: 200,
              useNativeDriver: true,
            }),
          ]),
        ]).start();

        // Check if all parts placed
        setTimeout(() => {
          if (newPlaced.size >= 4) {
            // All parts placed!
            setScore((s) => {
              const newScore = s + 1;
              
              setTimeout(() => {
                setRound((r) => {
                  if (r < TOTAL_ROUNDS) {
                    setShowPuzzle(false);
                    setPlacedParts(new Set());
                    setDraggingPart(null);
                    // Reset all positions
                    Object.keys(BODY_PARTS).forEach((key) => {
                      const bp = key as BodyPart;
                      partPositions.current[bp].x.setValue(BODY_PARTS[bp].startX);
                      partPositions.current[bp].y.setValue(BODY_PARTS[bp].startY);
                      partPositions.current[bp].scale.setValue(1);
                    });
                    return r + 1;
                  } else {
                    endGame();
                    return r;
                  }
                });
              }, 1000);
              
              return newScore;
            });
          }
        }, 500);
        
        return newPlaced;
      } else {
        // Wrong position - spring back
        setDraggingPart(null);
        
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
        speakTTS(`${part} ko sahi jagah lagao!`, 0.8 );
        
        Animated.parallel([
          Animated.spring(partPositions.current[part].x, {
            toValue: target.startX,
            damping: 10,
            stiffness: 100,
            useNativeDriver: false,
          }),
          Animated.spring(partPositions.current[part].y, {
            toValue: target.startY,
            damping: 10,
            stiffness: 100,
            useNativeDriver: false,
          }),
          Animated.timing(partPositions.current[part].scale, {
            toValue: 1,
            duration: 300,
            useNativeDriver: true,
          }),
        ]).start();
        
        return currentPlaced;
      }
    });
  }, [done, endGame]);

  const showPuzzleObject = useCallback(() => {
    setShowPuzzle(true);
    setPlacedParts(new Set());
    setDraggingPart(null);
    
    // Reset all positions
    Object.keys(BODY_PARTS).forEach((key) => {
      const bp = key as BodyPart;
      partPositions.current[bp].x.setValue(BODY_PARTS[bp].startX);
      partPositions.current[bp].y.setValue(BODY_PARTS[bp].startY);
      partPositions.current[bp].scale.setValue(1);
    });
    
    speakTTS('Body parts ko sahi jagah lagao! Drag karke sahi place pe rakho!', 0.8 );
  }, [partPositions]);

  const startRound = useCallback(() => {
    if (done) return;
    setTimeout(() => {
      showPuzzleObject();
    }, 500);
  }, [done, showPuzzleObject]);

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
        title="Body Puzzle"
        emoji="🧩"
        description="Body parts ko sahi jagah lagana! Drag karke sahi place pe rakho!"
        skills={['Spatial understanding', 'Body parts', 'Puzzle solving']}
        suitableFor="Children learning spatial understanding and body part placement"
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
            setShowPuzzle(false);
            setPlacedParts(new Set());
            setDraggingPart(null);
            Object.keys(BODY_PARTS).forEach((key) => {
              const bp = key as BodyPart;
              partPositions.current[bp].x.setValue(BODY_PARTS[bp].startX);
              partPositions.current[bp].y.setValue(BODY_PARTS[bp].startY);
              partPositions.current[bp].scale.setValue(1);
            });
          }}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView
      style={styles.container}
      onLayout={(e) => {
        screenWidth.current = e.nativeEvent.layout.width;
        screenHeight.current = e.nativeEvent.layout.height;
      }}
    >
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
        <Text style={styles.title}>Body Puzzle</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • 🧩 Score: {score}
        </Text>
        <Text style={styles.instruction}>
          Body parts ko sahi jagah lagao! Drag karke place karo!
        </Text>
        <Text style={styles.progressText}>
          Placed: {placedParts.size}/4
        </Text>
      </View>

      <View style={styles.gameArea}>
        {showPuzzle && (
          <>
            {/* Target outlines */}
            {Object.values(BODY_PARTS).map((part) => (
              <View
                key={part.id}
                style={[
                  styles.targetOutline,
                  {
                    left: `${part.targetX}%`,
                    top: `${part.targetY}%`,
                    transform: [
                      { translateX: -40 },
                      { translateY: -40 },
                    ],
                    opacity: placedParts.has(part.id) ? 0.3 : 0.6,
                    borderColor: placedParts.has(part.id) ? '#22C55E' : '#3B82F6',
                  },
                ]}
              >
                <Text style={styles.targetEmoji}>{part.emoji}</Text>
              </View>
            ))}

            {/* Draggable body parts */}
            <Animated.View
              {...headPanResponder.panHandlers}
              style={[
                styles.partContainer,
                {
                  left: partPositions.current.head.x.interpolate({
                    inputRange: [0, 100],
                    outputRange: ['0%', '100%'],
                  }),
                  top: partPositions.current.head.y.interpolate({
                    inputRange: [0, 100],
                    outputRange: ['0%', '100%'],
                  }),
                  transform: [
                    { translateX: -40 },
                    { translateY: -40 },
                    { scale: partPositions.current.head.scale },
                  ],
                  opacity: placedParts.has('head') ? 0.5 : 1,
                  zIndex: draggingPart === 'head' ? 10 : 1,
                },
              ]}
            >
              <Text style={styles.partEmoji}>{BODY_PARTS.head.emoji}</Text>
            </Animated.View>

            <Animated.View
              {...torsoPanResponder.panHandlers}
              style={[
                styles.partContainer,
                {
                  left: partPositions.current.torso.x.interpolate({
                    inputRange: [0, 100],
                    outputRange: ['0%', '100%'],
                  }),
                  top: partPositions.current.torso.y.interpolate({
                    inputRange: [0, 100],
                    outputRange: ['0%', '100%'],
                  }),
                  transform: [
                    { translateX: -40 },
                    { translateY: -40 },
                    { scale: partPositions.current.torso.scale },
                  ],
                  opacity: placedParts.has('torso') ? 0.5 : 1,
                  zIndex: draggingPart === 'torso' ? 10 : 1,
                },
              ]}
            >
              <Text style={styles.partEmoji}>{BODY_PARTS.torso.emoji}</Text>
            </Animated.View>

            <Animated.View
              {...armPanResponder.panHandlers}
              style={[
                styles.partContainer,
                {
                  left: partPositions.current.arm.x.interpolate({
                    inputRange: [0, 100],
                    outputRange: ['0%', '100%'],
                  }),
                  top: partPositions.current.arm.y.interpolate({
                    inputRange: [0, 100],
                    outputRange: ['0%', '100%'],
                  }),
                  transform: [
                    { translateX: -40 },
                    { translateY: -40 },
                    { scale: partPositions.current.arm.scale },
                  ],
                  opacity: placedParts.has('arm') ? 0.5 : 1,
                  zIndex: draggingPart === 'arm' ? 10 : 1,
                },
              ]}
            >
              <Text style={styles.partEmoji}>{BODY_PARTS.arm.emoji}</Text>
            </Animated.View>

            <Animated.View
              {...legPanResponder.panHandlers}
              style={[
                styles.partContainer,
                {
                  left: partPositions.current.leg.x.interpolate({
                    inputRange: [0, 100],
                    outputRange: ['0%', '100%'],
                  }),
                  top: partPositions.current.leg.y.interpolate({
                    inputRange: [0, 100],
                    outputRange: ['0%', '100%'],
                  }),
                  transform: [
                    { translateX: -40 },
                    { translateY: -40 },
                    { scale: partPositions.current.leg.scale },
                  ],
                  opacity: placedParts.has('leg') ? 0.5 : 1,
                  zIndex: draggingPart === 'leg' ? 10 : 1,
                },
              ]}
            >
              <Text style={styles.partEmoji}>{BODY_PARTS.leg.emoji}</Text>
            </Animated.View>
          </>
        )}

        {!showPuzzle && (
          <View style={styles.waitingContainer}>
            <Text style={styles.waitingText}>Get ready...</Text>
          </View>
        )}
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Skills: Spatial understanding • Body parts • Puzzle solving
        </Text>
        <Text style={styles.footerSubtext}>
          Drag and drop body parts to their correct positions!
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
  progressText: {
    fontSize: 18,
    color: '#22C55E',
    fontWeight: '800',
  },
  gameArea: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
    marginVertical: 40,
  },
  targetOutline: {
    position: 'absolute',
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 3,
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(59, 130, 246, 0.1)',
    zIndex: 1,
  },
  targetEmoji: {
    fontSize: 50,
    opacity: 0.5,
  },
  partContainer: {
    position: 'absolute',
    width: 80,
    height: 80,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 40,
    borderWidth: 2,
    borderColor: '#3B82F6',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 3 },
    elevation: 5,
  },
  partEmoji: {
    fontSize: 50,
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

export default BodyPuzzleGame;

