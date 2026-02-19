import { SparkleBurst } from '@/components/game/FX';
import ResultCard from '@/components/game/ResultCard';
import { logGameAndAward, recordGame } from '@/utils/api';
import { cleanupSounds, stopAllSpeech } from '@/utils/soundPlayer';
import { Audio as ExpoAudio } from 'expo-av';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { speak as speakTTS, DEFAULT_TTS_RATE, stopTTS } from '@/utils/tts';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    Platform,
    SafeAreaView,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
    useAnimatedStyle,
    useSharedValue,
} from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';

const SUCCESS_SOUND = 'https://actions.google.com/sounds/v1/cartoon/balloon_pop.ogg';
const WARNING_SOUND = 'https://actions.google.com/sounds/v1/cartoon/wood_plank_flicks.ogg';
const TOTAL_ROUNDS = 6;
const MIRROR_LINE_X = 50;

const useSoundEffect = (uri: string) => {
  const soundRef = useRef<ExpoAudio.Sound | null>(null);

  const ensureSound = useCallback(async () => {
    if (soundRef.current) return;
    try {
      const { sound } = await ExpoAudio.Sound.createAsync(
        { uri },
        { volume: 0.6, shouldPlay: false },
      );
      soundRef.current = sound;
    } catch {
      console.warn('Failed to load sound:', uri);
    }
  }, [uri]);

  useEffect(() => {
    return () => {
      soundRef.current?.unloadAsync().catch(() => {});
    };
  }, []);

  const play = useCallback(async () => {
    try {
      if (Platform.OS === 'web') return;
      await ensureSound();
      if (soundRef.current) await soundRef.current.replayAsync();
    } catch {}
  }, [ensureSound]);

  return play;
};

const ButterflyWingsGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const playSuccess = useSoundEffect(SUCCESS_SOUND);
  const playWarning = useSoundEffect(WARNING_SOUND);

  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [logTimestamp, setLogTimestamp] = useState<string | null>(null);
  const [roundActive, setRoundActive] = useState(true);
  const [isDrawing, setIsDrawing] = useState(false);
  const [leftWingPath, setLeftWingPath] = useState<Array<{ x: number; y: number }>>([]);
  const [rightWingPath, setRightWingPath] = useState<Array<{ x: number; y: number }>>([]);
  const sparkleX = useSharedValue(50);
  const sparkleY = useSharedValue(50);

  const screenWidth = useRef(400);
  const screenHeight = useRef(600);

  const endGame = useCallback(
    async (finalScore: number) => {
      const total = TOTAL_ROUNDS;
      const xp = finalScore * 20;
      const accuracy = (finalScore / total) * 100;

      setFinalStats({ correct: finalScore, total, xp });
      setDone(true);
      setRoundActive(false);

      try {
        await recordGame(xp);
        const result = await logGameAndAward({
          type: 'butterflyWings',
          correct: finalScore,
          total,
          accuracy,
          xpAwarded: xp,
          skillTags: ['bilateral-coordination', 'spatial-awareness', 'mirror-drawing'],
        });
        setLogTimestamp(result?.last?.at ?? null);
        router.setParams({ refreshStats: Date.now().toString() });
      } catch (e) {
        console.error('Failed to log butterfly wings game:', e);
      }

      speakTTS('Butterfly complete!', 0.78 );
    },
    [router],
  );

  const panGesture = Gesture.Pan()
    .onStart((e) => {
      if (!roundActive || done) return;
      setIsDrawing(true);
      
      const x = (e.x / screenWidth.current) * 100;
      const y = (e.y / screenHeight.current) * 100;
      
      if (x < MIRROR_LINE_X) {
        setLeftWingPath([{ x, y }]);
        const mirrorX = MIRROR_LINE_X + (MIRROR_LINE_X - x);
        setRightWingPath([{ x: mirrorX, y }]);
      }
    })
    .onUpdate((e) => {
      if (!roundActive || done || !isDrawing) return;
      
      const x = (e.x / screenWidth.current) * 100;
      const y = (e.y / screenHeight.current) * 100;
      
      if (x < MIRROR_LINE_X) {
        setLeftWingPath(prev => [...prev, { x, y }]);
        const mirrorX = MIRROR_LINE_X + (MIRROR_LINE_X - x);
        setRightWingPath(prev => [...prev, { x: mirrorX, y }]);
      }
    })
    .onEnd(() => {
      if (!roundActive || done) return;
      setIsDrawing(false);
      
      if (leftWingPath.length > 15) {
        sparkleX.value = MIRROR_LINE_X;
        sparkleY.value = 50;
        
        setScore(s => {
          const newScore = s + 1;
          if (newScore >= TOTAL_ROUNDS) {
            setTimeout(() => {
              endGame(newScore);
            }, 1000);
          } else {
            setTimeout(() => {
              setRound(r => r + 1);
              setLeftWingPath([]);
              setRightWingPath([]);
              setRoundActive(true);
            }, 1500);
          }
          return newScore;
        });

        try {
          playSuccess();
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        } catch {}
      } else {
        setLeftWingPath([]);
        setRightWingPath([]);
        try {
          playWarning();
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          speakTTS('Draw a wing shape!', 0.78 );
        } catch {}
      }
    });

  useEffect(() => {
    setLeftWingPath([]);
    setRightWingPath([]);
    setRoundActive(true);
    try {
      speakTTS('Draw one wing on the left, and it will mirror on the right!', { rate: 0.78 });
    } catch {}
    
    return () => {
      stopAllSpeech();
      cleanupSounds();
    };
  }, [round]);

  useEffect(() => {
    return () => {
      stopAllSpeech();
      cleanupSounds();
    };
  }, []);

  const handleBack = useCallback(() => {
    stopAllSpeech();
    cleanupSounds();
    onBack?.();
  }, [onBack]);

  const sparkleStyle = useAnimatedStyle(() => ({
    left: `${sparkleX.value}%`,
    top: `${sparkleY.value}%`,
  }));

  const pathToSvg = (path: Array<{ x: number; y: number }>) => {
    if (path.length === 0) return '';
    if (path.length === 1) return `M ${path[0].x} ${path[0].y}`;
    return `M ${path[0].x} ${path[0].y} ${path.slice(1).map(p => `L ${p.x} ${p.y}`).join(' ')}`;
  };

  if (done && finalStats) {
    const accuracyPct = Math.round((finalStats.correct / finalStats.total) * 100);
    return (
      <SafeAreaView style={styles.container}>
        <TouchableOpacity onPress={handleBack} style={styles.backChip}>
          <Text style={styles.backChipText}>← Back</Text>
        </TouchableOpacity>
        <ScrollView
          contentContainerStyle={{
            flexGrow: 1,
            justifyContent: 'center',
            alignItems: 'center',
            padding: 24,
          }}
        >
          <View style={styles.resultCard}>
            <Text style={{ fontSize: 64, marginBottom: 16 }}>🦋</Text>
            <Text style={styles.resultTitle}>Butterflies Complete!</Text>
            <Text style={styles.resultSubtitle}>
              You drew {finalStats.correct} butterflies out of {finalStats.total}!
            </Text>
            <ResultCard
              correct={finalStats.correct}
              total={finalStats.total}
              xpAwarded={finalStats.xp}
              accuracy={accuracyPct}
              logTimestamp={logTimestamp}
              onPlayAgain={() => {
                setRound(1);
                setScore(0);
                setDone(false);
                setFinalStats(null);
                setLogTimestamp(null);
                setLeftWingPath([]);
                setRightWingPath([]);
                setRoundActive(true);
              }}
            />
            <Text style={styles.savedText}>Saved! XP updated ✅</Text>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <TouchableOpacity onPress={handleBack} style={styles.backChip}>
        <Text style={styles.backChipText}>← Back</Text>
      </TouchableOpacity>

      <View style={styles.headerBlock}>
        <Text style={styles.title}>Butterfly Wings</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • 🦋 Score: {score}
        </Text>
        <Text style={styles.helper}>
          Draw one wing on the left, and it will mirror on the right!
        </Text>
      </View>

      <View
        style={styles.playArea}
        onLayout={(e) => {
          screenWidth.current = e.nativeEvent.layout.width;
          screenHeight.current = e.nativeEvent.layout.height;
        }}
      >
        <GestureDetector gesture={panGesture}>
          <View style={styles.gestureArea}>
            <Svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" style={styles.svg}>
              {/* Mirror line */}
              <Path
                d={`M ${MIRROR_LINE_X} 10 L ${MIRROR_LINE_X} 90`}
                stroke="#CBD5E1"
                strokeWidth="1"
                strokeDasharray="2 2"
              />
              
              {/* Butterfly body */}
              <Path
                d={`M ${MIRROR_LINE_X} 35 L ${MIRROR_LINE_X} 65`}
                stroke="#F59E0B"
                strokeWidth="2"
                strokeLinecap="round"
              />
              
              {/* Left wing */}
              {leftWingPath.length > 0 && (
                <Path
                  d={pathToSvg(leftWingPath)}
                  stroke="#8B5CF6"
                  strokeWidth="3"
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )}
              
              {/* Right mirrored wing */}
              {rightWingPath.length > 0 && (
                <Path
                  d={pathToSvg(rightWingPath)}
                  stroke="#8B5CF6"
                  strokeWidth="3"
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )}
            </Svg>

            {score > 0 && (
              <Animated.View style={[styles.sparkleContainer, sparkleStyle]} pointerEvents="none">
                <SparkleBurst />
              </Animated.View>
            )}
          </View>
        </GestureDetector>
      </View>

      <View style={styles.footerBox}>
        <Text style={styles.footerMain}>
          Skills: bilateral coordination • spatial awareness • mirror drawing
        </Text>
        <Text style={styles.footerSub}>
          Draw one wing, watch the other appear!
        </Text>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 16,
    paddingTop: 48,
  },
  backChip: {
    position: 'absolute',
    top: 50,
    left: 16,
    zIndex: 10,
    backgroundColor: '#0F172A',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  backChipText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
  },
  headerBlock: {
    marginTop: 72,
    marginBottom: 16,
    alignItems: 'center',
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 16,
    color: '#0F172A',
    marginBottom: 6,
  },
  helper: {
    fontSize: 14,
    color: '#475569',
    textAlign: 'center',
    paddingHorizontal: 18,
  },
  playArea: {
    flex: 1,
    position: 'relative',
    marginBottom: 16,
  },
  gestureArea: {
    flex: 1,
    position: 'relative',
  },
  svg: {
    position: 'absolute',
    width: '100%',
    height: '100%',
  },
  sparkleContainer: {
    position: 'absolute',
    transform: [{ translateX: -20 }, { translateY: -20 }],
    zIndex: 4,
  },
  footerBox: {
    paddingVertical: 14,
    marginBottom: 20,
  },
  footerMain: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
    textAlign: 'center',
    marginBottom: 4,
  },
  footerSub: {
    fontSize: 13,
    color: '#64748B',
    textAlign: 'center',
  },
  resultCard: {
    width: '100%',
    maxWidth: 420,
    borderRadius: 24,
    backgroundColor: '#fff',
    padding: 24,
    alignItems: 'center',
    marginTop: 16,
  },
  resultTitle: {
    fontSize: 26,
    fontWeight: '900',
    color: '#0F172A',
    marginBottom: 8,
  },
  resultSubtitle: {
    fontSize: 16,
    color: '#475569',
    marginBottom: 16,
    textAlign: 'center',
  },
  savedText: {
    color: '#22C55E',
    fontWeight: '600',
    marginTop: 16,
    textAlign: 'center',
  },
});

export default ButterflyWingsGame;

