import React from 'react';
import {Composition, registerRoot} from 'remotion';
import {OpenAssetsShowcase} from './video';
import './styles.css';

const Root = () => <Composition id="OpenAssetsShowcase" component={OpenAssetsShowcase} width={1920} height={1080} fps={30} durationInFrames={1200}/>;
registerRoot(Root);
