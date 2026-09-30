-- 字幕组协作校对平台 —— 数据库初始化脚本
-- 由 Postgres 官方镜像在容器首次启动时自动执行（/docker-entrypoint-initdb.d）

BEGIN;

-- ---------- 用户 ----------
CREATE TABLE users (
    id          BIGSERIAL PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    -- editor: 编辑/提交修订；reviewer: 额外可确认片段；admin: 二者皆可
    role        TEXT NOT NULL CHECK (role IN ('editor', 'reviewer', 'admin')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- 字幕项目 ----------
CREATE TABLE projects (
    id          BIGSERIAL PRIMARY KEY,
    title       TEXT NOT NULL,
    created_by  BIGINT NOT NULL REFERENCES users(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- 片段（每段当前状态） ----------
CREATE TABLE segments (
    id                   BIGSERIAL PRIMARY KEY,
    project_id           BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    position             INT NOT NULL,                       -- 原顺序，从 1 开始，永不重排
    text                 TEXT NOT NULL,
    start_ms             BIGINT NOT NULL CHECK (start_ms >= 0),
    end_ms               BIGINT NOT NULL CHECK (end_ms   > start_ms),
    status               TEXT NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending', 'confirmed')),
    current_revision_id  BIGINT,
    UNIQUE (project_id, position)
);

-- ---------- 修订记录（只增不改，完整审计链） ----------
CREATE TABLE revisions (
    id                     BIGSERIAL PRIMARY KEY,
    segment_id             BIGINT NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
    project_id             BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    revision_no            INT NOT NULL,                   -- 段内序号，从 1 递增
    text                   TEXT NOT NULL,
    start_ms               BIGINT NOT NULL CHECK (start_ms >= 0),
    end_ms                 BIGINT NOT NULL CHECK (end_ms > start_ms),
    author_id              BIGINT NOT NULL REFERENCES users(id),
    based_on_revision_id   BIGINT REFERENCES revisions(id), -- 乐观并发：基于哪个旧修订提交
    note                   TEXT,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (segment_id, revision_no)
);

-- 循环外键（segments.current_revision_id -> revisions.id），事务提交时延迟检查
ALTER TABLE segments
    ADD CONSTRAINT segments_current_revision_fk
    FOREIGN KEY (current_revision_id) REFERENCES revisions(id)
    DEFERRABLE INITIALLY DEFERRED;

-- ---------- 不可变发布版本（快照） ----------
CREATE TABLE releases (
    id             BIGSERIAL PRIMARY KEY,
    project_id     BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    version        INT NOT NULL,                        -- 项目内版本号，从 1 递增
    published_by   BIGINT NOT NULL REFERENCES users(id),
    published_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    segment_count  INT NOT NULL,
    UNIQUE (project_id, version)
);

-- 发布时逐段复制内容，此后与 segments/revisions 完全隔离，不可变
CREATE TABLE release_segments (
    release_id  BIGINT NOT NULL REFERENCES releases(id) ON DELETE CASCADE,
    position    INT NOT NULL,
    text        TEXT NOT NULL,
    start_ms    BIGINT NOT NULL,
    end_ms      BIGINT NOT NULL,
    PRIMARY KEY (release_id, position)
);

CREATE INDEX idx_segments_project_start ON segments (project_id, start_ms);
CREATE INDEX idx_revisions_segment      ON revisions (segment_id, revision_no DESC);
CREATE INDEX idx_revisions_project      ON revisions (project_id);
CREATE INDEX idx_releases_project       ON releases (project_id, version DESC);

-- ---------- 演示账号（可在界面中直接选择） ----------
INSERT INTO users (name, role) VALUES
    ('alice', 'editor'),
    ('bob',   'editor'),
    ('carol', 'reviewer'),
    ('admin', 'admin')
ON CONFLICT (name) DO NOTHING;

COMMIT;
