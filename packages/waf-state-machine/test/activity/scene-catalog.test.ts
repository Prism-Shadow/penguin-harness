import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { sceneCatalogFromConfiguration } from '../../src/activity/scene-catalog.ts';

describe('sceneCatalogFromConfiguration', () => {
  it('exposes validated canonical scene data through one lookup interface', () => {
    const catalog = sceneCatalogFromConfiguration({
      activityScenes: [
        {
          animationKeys: ['opening-sparkle'],
          audioKeys: ['opening-narration'],
          description: 'The treasure chest opens.',
          id: 'scene-1',
          imageKeys: ['activity-cover'],
          videoKeys: ['opening-video'],
        },
      ],
    });

    assert.deepEqual(catalog.sceneIds, ['scene-1']);
    assert.deepEqual(catalog.scene('scene-1'), {
      animationKeys: ['opening-sparkle'],
      audioKeys: ['opening-narration'],
      description: 'The treasure chest opens.',
      id: 'scene-1',
      imageKeys: ['activity-cover'],
      videoKeys: ['opening-video'],
    });
    assert.throws(() => catalog.scene('missing'), /Unknown activity scene "missing"/);
  });

  it('requires each state machine scene while allowing shared non-playable scenes', () => {
    assert.throws(
      () => sceneCatalogFromConfiguration(
        { activityScenes: [scene('scene-1')] },
        ['scene-1', 'scene-2'],
      ),
      /missing state machine scene "scene-2"/,
    );

    const catalog = sceneCatalogFromConfiguration(
      { activityScenes: [scene('general'), scene('scene-1')] },
      ['scene-1'],
    );
    assert.deepEqual(catalog.sceneIds, ['general', 'scene-1']);
    assert.equal(catalog.scene('general').id, 'general');
  });
});

function scene(id: string): Record<string, unknown> {
  return {
    animationKeys: [],
    audioKeys: [],
    description: id,
    id,
    imageKeys: [],
    videoKeys: [],
  };
}
