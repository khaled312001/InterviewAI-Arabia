import Svg, { Path, Circle, Defs, LinearGradient, Stop, G } from 'react-native-svg';

interface Props { size?: number }

// Simple, clean mark: stylized chat bubble with an "A" (Arabic first letter) + dots (AI).
// Designed to be recognizable at 24px and 256px.
export function Logo({ size = 96 }: Props) {
  return (
    <Svg width={size} height={size} viewBox="0 0 96 96" fill="none">
      <Defs>
        <LinearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#3679C6" />
          <Stop offset="1" stopColor="#0A3F75" />
        </LinearGradient>
      </Defs>
      <G>
        <Path
          d="M20 16h50c6.6 0 12 5.4 12 12v34c0 6.6-5.4 12-12 12H40l-14 12V74h-6c-6.6 0-12-5.4-12-12V28c0-6.6 5.4-12 12-12Z"
          fill="url(#g)"
        />
        <Path
          d="M38 60 52 30h6l14 30h-8l-3.2-7H49.2L46 60h-8Zm13.8-13.2h8.4L56 36.8l-4.2 10Z"
          fill="#FFFFFF"
        />
        <Circle cx="68" cy="74" r="3" fill="#F39C12" />
        <Circle cx="76" cy="74" r="3" fill="#F39C12" />
        <Circle cx="84" cy="74" r="3" fill="#F39C12" />
      </G>
    </Svg>
  );
}
