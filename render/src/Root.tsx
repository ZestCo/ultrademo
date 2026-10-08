import {Composition, staticFile} from 'remotion';
import {CaptionStyle, Demo, FPS, Layout, Storyboard, totalFrames} from './Demo';

type Props = {
  storyboard: Storyboard | null;
  layout?: Layout;
  captions?: boolean;
  audio?: boolean;
  caption?: CaptionStyle;
};

// The render runs with --public-dir projects/<name>/assets, so the storyboard
// and all asset paths resolve relative to that project.
const loadStoryboard = async ({props}: {props: Props}) => {
  const storyboard: Storyboard = await fetch(staticFile('storyboard.json')).then((r) => r.json());
  // Brand profile: render.mjs copies brands/<theme>/ into the public dir as brand/.
  if (storyboard.theme) {
    const theme = await fetch(staticFile('brand/brand.json')).then((r) => r.json());
    theme.layers = await fetch(staticFile(theme.logo.layers)).then((r) => r.json());
    if (theme.logo.mark_parts) theme.mark = await fetch(staticFile(theme.logo.mark_parts)).then((r) => r.json());
    storyboard.brandTheme = theme;
  }
  return {durationInFrames: totalFrames(storyboard), props: {...props, storyboard}};
};

const DemoWide: React.FC<Props> = (p) => (
  <Demo storyboard={p.storyboard} layout="wide" captions={p.captions ?? true} audio={p.audio ?? true} caption={p.caption} />
);
const DemoVertical: React.FC<Props> = (p) => (
  <Demo storyboard={p.storyboard} layout="vertical" captions={p.captions ?? true} audio={p.audio ?? true} caption={p.caption} />
);

export const Root: React.FC = () => {
  return (
    <>
      <Composition
        id="Demo"
        component={DemoWide}
        width={1920}
        height={1080}
        fps={FPS}
        durationInFrames={300}
        defaultProps={{storyboard: null}}
        calculateMetadata={loadStoryboard}
      />
      <Composition
        id="DemoVertical"
        component={DemoVertical}
        width={1080}
        height={1920}
        fps={FPS}
        durationInFrames={300}
        defaultProps={{storyboard: null}}
        calculateMetadata={loadStoryboard}
      />
    </>
  );
};
