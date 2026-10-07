import { describe, it, expect } from 'vitest';
import { parseImageUrl } from './image-ref';

describe('parseImageUrl', () => {
  it.each([
    ['busybox', 'docker.io', 'library/busybox'],
    ['bitnami/redis', 'docker.io', 'bitnami/redis'],
    ['docker.io/library/busybox', 'docker.io', 'library/busybox'],
    ['gcr.io/google-containers/pause', 'gcr.io', 'google-containers/pause'],
    ['us.gcr.io/project/image', 'us.gcr.io', 'project/image'],
    ['quay.io/prometheus/busybox', 'quay.io', 'prometheus/busybox'],
    ['ghcr.io/linuxcontainers/alpine', 'ghcr.io', 'linuxcontainers/alpine'],
    ['registry.k8s.io/pause', 'registry.k8s.io', 'pause'],
    ['public.ecr.aws/docker/library/busybox', 'public.ecr.aws', 'docker/library/busybox'],
    ['localhost:5000/team/app', 'localhost:5000', 'team/app'],
    ['localhost/app', 'localhost', 'app'],
  ])('%s is %s / %s', (name, registry, repository) => {
    expect(parseImageUrl(name)).toEqual({ registry, repository });
  });

  it('refuses a tag in the name', () => {
    expect(parseImageUrl('busybox:1.36')).toBeNull();
    expect(parseImageUrl('quay.io/prometheus/busybox:latest')).toBeNull();
  });
});
