import { NextResponse } from 'next/server';
import { getDB } from '@/lib/db-helpers';

type SemesterRecord = Record<string, unknown> & {
  is_active?: number | boolean;
};

async function checkAdmin(db: any, username: string): Promise<{ success: boolean; error?: string }> {
  const user = await db
    .prepare('SELECT is_admin FROM users WHERE username = ?')
    .bind(username)
    .first();

  if (!user || (user as any).is_admin !== 1) {
    return { success: false, error: '需要管理员权限' };
  }
  return { success: true };
}

function normalizeSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-_]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

async function makeUniqueSlug(db: any, baseSlug: string, excludeId?: number): Promise<string> {
  const fallback = `category-${Date.now()}`;
  const base = normalizeSlug(baseSlug) || fallback;
  let slug = base;
  let suffix = 2;

  while (true) {
    const existing = excludeId
      ? await db.prepare('SELECT id FROM semesters WHERE slug = ? AND id != ?').bind(slug, excludeId).first()
      : await db.prepare('SELECT id FROM semesters WHERE slug = ?').bind(slug).first();

    if (!existing) return slug;
    slug = `${base}-${suffix}`;
    suffix += 1;
  }
}

function serializeSemester(semester: SemesterRecord) {
  return {
    ...semester,
    is_active: semester.is_active === 1 || semester.is_active === true
  };
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { adminUsername, name, slug, description } = body;

    if (!adminUsername) {
      return NextResponse.json({ error: '需要管理员权限' }, { status: 403 });
    }

    const trimmedName = typeof name === 'string' ? name.trim() : '';
    if (!trimmedName) {
      return NextResponse.json({ error: '分类名称不能为空' }, { status: 400 });
    }

    const db = getDB();
    const adminCheck = await checkAdmin(db, adminUsername);
    if (!adminCheck.success) {
      return NextResponse.json({ error: adminCheck.error }, { status: 403 });
    }

    const maxOrder = await db
      .prepare('SELECT MAX("order") as max_order FROM semesters')
      .first();
    const nextOrder = maxOrder && (maxOrder as any).max_order !== null
      ? (maxOrder as any).max_order + 1
      : 1;
    const rawDescription = typeof description === 'string' ? description.trim() : '';
    const uniqueSlug = await makeUniqueSlug(db, typeof slug === 'string' ? slug : trimmedName);

    const semester = await db
      .prepare(`
        INSERT INTO semesters (name, slug, description, "order", is_active)
        VALUES (?, ?, ?, ?, 1)
        RETURNING *
      `)
      .bind(trimmedName, uniqueSlug, rawDescription || null, nextOrder)
      .first();

    if (!semester) {
      return NextResponse.json({ error: '分类创建失败' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      semester: serializeSemester(semester as SemesterRecord)
    });
  } catch (error) {
    console.error('Error creating semester:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const { adminUsername, id, name, slug, description, order, isActive } = body;

    if (!adminUsername || !id) {
      return NextResponse.json({ error: '缺少参数' }, { status: 400 });
    }

    const db = getDB();
    const adminCheck = await checkAdmin(db, adminUsername);
    if (!adminCheck.success) {
      return NextResponse.json({ error: adminCheck.error }, { status: 403 });
    }

    const existing = await db
      .prepare('SELECT id FROM semesters WHERE id = ?')
      .bind(id)
      .first();
    if (!existing) {
      return NextResponse.json({ error: '分类不存在' }, { status: 404 });
    }

    const updates: string[] = [];
    const params: any[] = [];

    if (name !== undefined) {
      const trimmedName = typeof name === 'string' ? name.trim() : '';
      if (!trimmedName) {
        return NextResponse.json({ error: '分类名称不能为空' }, { status: 400 });
      }
      updates.push('name = ?');
      params.push(trimmedName);
    }

    if (slug !== undefined) {
      const uniqueSlug = await makeUniqueSlug(db, typeof slug === 'string' ? slug : name || `category-${id}`, Number(id));
      updates.push('slug = ?');
      params.push(uniqueSlug);
    }

    if (description !== undefined) {
      updates.push('description = ?');
      params.push(typeof description === 'string' ? description.trim() || null : null);
    }

    if (order !== undefined) {
      updates.push('"order" = ?');
      params.push(Number(order) || 0);
    }

    if (isActive !== undefined) {
      updates.push('is_active = ?');
      params.push(isActive ? 1 : 0);
    }

    if (updates.length === 0) {
      return NextResponse.json({ error: '没有要更新的内容' }, { status: 400 });
    }

    const semester = await db
      .prepare(`UPDATE semesters SET ${updates.join(', ')} WHERE id = ? RETURNING *`)
      .bind(...params, id)
      .first();

    if (!semester) {
      return NextResponse.json({ error: '分类更新失败' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      semester: serializeSemester(semester as SemesterRecord)
    });
  } catch (error) {
    console.error('Error updating semester:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const adminUsername = searchParams.get('adminUsername');
    const id = searchParams.get('id');

    if (!adminUsername || !id) {
      return NextResponse.json({ error: '缺少参数' }, { status: 400 });
    }

    const semesterId = parseInt(id, 10);
    if (Number.isNaN(semesterId)) {
      return NextResponse.json({ error: '分类ID无效' }, { status: 400 });
    }

    const db = getDB();
    const adminCheck = await checkAdmin(db, adminUsername);
    if (!adminCheck.success) {
      return NextResponse.json({ error: adminCheck.error }, { status: 403 });
    }

    const existing = await db
      .prepare('SELECT id FROM semesters WHERE id = ?')
      .bind(semesterId)
      .first();
    if (!existing) {
      return NextResponse.json({ error: '分类不存在' }, { status: 404 });
    }

    await db.prepare('DELETE FROM study_stats WHERE semester_id = ?').bind(semesterId).run();
    await db.prepare('DELETE FROM user_progress WHERE semester_id = ?').bind(semesterId).run();
    await db.prepare('DELETE FROM vocab_words WHERE semester_id = ?').bind(semesterId).run();
    await db.prepare('DELETE FROM semesters WHERE id = ?').bind(semesterId).run();

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting semester:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
