/**
 * Gaze Visualization Component
 * Shows visual feedback for gaze point on screen
 */

import React from 'react';
import { StyleSheet, View, Animated as RNAnimated } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { GazePoint } from '@/utils/eyeTracking';

interface GazeVisualizationProps {
  gazePoint: GazePoint | null;
  visible: boolean;
  showTrail?: boolean;
}

export const GazeVisualization: React.FC<GazeVisualizationProps> = ({
  gazePoint,
  visible,
  showTrail = false,
}) => {
  const gazeX = useSharedValue(0.5);
  const gazeY = useSharedValue(0.5);
  const opacity = useSharedValue(0);

  React.useEffect(() => {
    if (visible && gazePoint) {
      gazeX.value = withSpring(gazePoint.x, {
        damping: 15,
        stiffness: 200,
      });
      gazeY.value = withSpring(gazePoint.y, {
        damping: 15,
        stiffness: 200,
      });
      opacity.value = withSpring(1, { damping: 12 });
    } else {
      opacity.value = withSpring(0, { damping: 12 });
    }
  }, [gazePoint, visible]);

  const cursorStyle = useAnimatedStyle(() => ({
    position: 'absolute',
    left: `${gazeX.value * 100}%`,
    top: `${gazeY.value * 100}%`,
    transform: [
      { translateX: -12 },
      { translateY: -12 },
    ],
    opacity: opacity.value,
  }));

  const ringStyle = useAnimatedStyle(() => ({
    opacity: opacity.value * 0.3,
    transform: [
      { scale: 1 + (1 - opacity.value) * 0.5 },
    ],
  }));

  if (!visible || !gazePoint) {
    return null;
  }

  return (
    <View style={styles.container} pointerEvents="none">
      {/* Outer ring */}
      <Animated.View style={[styles.outerRing, ringStyle]} />
      
      {/* Gaze cursor */}
      <Animated.View style={[styles.cursor, cursorStyle]}>
        <View style={styles.cursorDot} />
        <View style={styles.cursorRing} />
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 1000,
  },
  cursor: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cursorDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#3B82F6',
    borderWidth: 2,
    borderColor: '#fff',
    shadowColor: '#3B82F6',
    shadowOpacity: 0.8,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 0 },
    elevation: 8,
  },
  cursorRing: {
    position: 'absolute',
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#3B82F6',
    opacity: 0.5,
  },
  outerRing: {
    position: 'absolute',
    width: 60,
    height: 60,
    borderRadius: 30,
    borderWidth: 2,
    borderColor: '#3B82F6',
    left: '50%',
    top: '50%',
    transform: [{ translateX: -30 }, { translateY: -30 }],
  },
});





































