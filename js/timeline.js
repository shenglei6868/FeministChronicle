document.addEventListener('DOMContentLoaded', () => {
    const timelineContainer = document.getElementById('timeline');
    const dataUrl = 'data/events.json?t=' + new Date().getTime(); // 加时间戳防止浏览器缓存不更新

    fetch(dataUrl)
        .then(response => {
            if (!response.ok) throw new Error('网络响应出错');
            return response.json();
        })
        .then(data => {
            renderHorizontalTimeline(data, timelineContainer);
        })
        .catch(error => {
            console.error('获取数据失败:', error);
            timelineContainer.innerHTML = '<p class="timeline-error">加载数据失败...</p>';
        });
});

function parseDateStr(dateStr) {
    return new Date(dateStr).getTime();
}

function formatDate(dateStr, includeDay = true) {
    const d = new Date(dateStr);
    const yearMonth = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    return includeDay ? `${yearMonth}-${String(d.getDate()).padStart(2,'0')}` : yearMonth;
}

function renderHorizontalTimeline(events, container) {
    if (!events || events.length === 0) {
        container.innerHTML = '<p class="timeline-subtitle">暂无事件。</p>';
        return;
    }

    // 绘制全局迷你轴和滚动区域容器
    container.innerHTML = `
        <div class="timeline-minimap-container" id="minimap-container">
            <div class="timeline-minimap-track" id="minimap-track"></div>
            <div class="timeline-minimap-viewport" id="minimap-viewport"></div>
        </div>
        <div class="timeline-scroll-area" id="scroll-area">
            <div class="timeline-track-container" id="track-container">
                <div class="timeline-axis"></div>
            </div>
        </div>
    `;

    const trackContainer = document.getElementById('track-container');
    const scrollArea = document.getElementById('scroll-area');
    const minimapTrack = document.getElementById('minimap-track');
    const minimapContainer = document.getElementById('minimap-container');
    const viewport = document.getElementById('minimap-viewport');

    // 1. 获取最小最大时间
    let minTime = Infinity;
    let maxTime = -Infinity;

    events.forEach(event => {
        const start = parseDateStr(event.startDate);
        const end = event.endDate ? parseDateStr(event.endDate) : start;
        if (start < minTime) minTime = start;
        if (end > maxTime) maxTime = end;
    });

    // 调整到当月月初，并往前推半年作为起点
    const minD = new Date(minTime);
    minD.setMonth(minD.getMonth() - 6);
    minD.setDate(1); minD.setHours(0,0,0,0);
    const adjustedMin = minD.getTime();

    // 调整到最后一个月之后的月初（多留一点余地）
    const maxD = new Date(maxTime);
    maxD.setMonth(maxD.getMonth() + 2);
    maxD.setDate(1); maxD.setHours(0,0,0,0);
    const adjustedMax = maxD.getTime();

    // 2. 将时间范围按月份划分为区块
    // 有事件的月份宽些，无事件的月份窄些
    const NORMAL_MONTH_WIDTH = 250;
    const EMPTY_MONTH_WIDTH = 60; // 动态压缩后的月份宽度
    const PADDING_OFFSET = 40; // 左右各空出一点像素避免卡边

    const monthBlocks = [];
    let currentMonth = new Date(adjustedMin);

    while (currentMonth.getTime() < adjustedMax) {
        let nextMonth = new Date(currentMonth);
        nextMonth.setMonth(nextMonth.getMonth() + 1);
        
        monthBlocks.push({
            start: currentMonth.getTime(),
            end: nextMonth.getTime(),
            hasEvent: false,
            width: 0,
            x: 0,
            label: formatDate(currentMonth.toISOString(), false)
        });
        currentMonth = nextMonth;
    }

        // 标记哪些月份包含了事件，以及单次事件的数量
        monthBlocks.forEach(mb => {
            mb.durationEventCount = 0;
            mb.pointEventCount = 0;
        });

        events.forEach(event => {
            const start = parseDateStr(event.startDate);
            const end = event.endDate ? parseDateStr(event.endDate) : start;
            const isDuration = event.type === 'duration';

            monthBlocks.forEach(mb => {
                // 如果事件时间段与该月份有重合部分
                if (start < mb.end && end >= mb.start) {
                    if (isDuration) {
                        mb.durationEventCount++;
                    } else {
                        mb.pointEventCount++;
                    }
                }
            });
        });

        // 仅当月份包含持续事件或大于等于2个单次事件时变宽
        let globalZoomScale = 1.0;
        
        function updateLayout() {
            let currentX = PADDING_OFFSET;
            monthBlocks.forEach(mb => {
                const isWide = mb.durationEventCount > 0 || mb.pointEventCount >= 2;
                const baseWidth = isWide ? NORMAL_MONTH_WIDTH : EMPTY_MONTH_WIDTH;
                mb.width = baseWidth * globalZoomScale;
                mb.x = currentX;
                currentX += mb.width;
            });
            const totalTrackWidth = currentX + PADDING_OFFSET;
            trackContainer.style.width = totalTrackWidth + 'px';
            return totalTrackWidth;
        }

        let totalTrackWidth = updateLayout();

        // 帮助函数：输入时间戳，返回在此动态坐标系中的像素位置
        function timeToX(time) {
            if (time <= adjustedMin) return PADDING_OFFSET;
            if (time >= adjustedMax) return trackContainer.clientWidth - PADDING_OFFSET;

            const mb = monthBlocks.find(m => time >= m.start && time < m.end);
            if (mb) {
                const ratio = (time - mb.start) / (mb.end - mb.start);
                return mb.x + ratio * mb.width;
            }
            return PADDING_OFFSET;
        }

        // 保存对所有创建的DOM节点的引用，方便缩放时更新位置
        const tickNodes = [];
        const eventNodes = [];

        // 3. 绘制月份刻度（主轨）
        monthBlocks.forEach((mb, idx) => {
            const isWide = mb.durationEventCount > 0 || mb.pointEventCount >= 2;
            const tick = document.createElement('div');
            tick.className = 'timeline-tick-container' + (isWide ? ' has-event' : '');
            tick.style.left = mb.x + 'px';
            tick.innerHTML = `<div class="timeline-tick-label">${mb.label}</div>`;
            trackContainer.appendChild(tick);
            tickNodes.push({ element: tick, monthIndex: idx, labelEl: tick.querySelector('.timeline-tick-label') });
        });

        function updateTickLabels(node) {
            const mb = monthBlocks[node.monthIndex];
            const labelEl = node.labelEl || node.element.querySelector('.timeline-tick-label');
            const d = new Date(mb.start);
            const yyyy = d.getFullYear();
            const mm = String(d.getMonth() + 1).padStart(2, '0');

            if (globalZoomScale < 0.4) {
                if (d.getMonth() === 0 || node.monthIndex === 0) {
                    labelEl.innerHTML = yyyy;
                } else {
                    labelEl.innerHTML = '';
                }
            } else if (globalZoomScale < 0.8) {
                if (d.getMonth() === 0 || node.monthIndex === 0) {
                    labelEl.innerHTML = `${yyyy}<br>-${mm}`;
                } else {
                    labelEl.innerHTML = `${mm}`;
                }
            } else if (globalZoomScale < 1.0) {
                if (d.getMonth() === 0 || node.monthIndex === 0) {
                    labelEl.innerHTML = `${yyyy}-${mm}`;
                } else {
                    labelEl.innerHTML = `${mm}`;
                }
            } else {
                labelEl.innerHTML = `${yyyy}-${mm}`;
            }
        }

        // 初始化时根据默认 zoom 设置文字
        tickNodes.forEach(node => {
            updateTickLabels(node);
        });

    // 绘制全局小地图 (Minimap) 年份刻度
    const minYear = minD.getFullYear();
    const maxYear = maxD.getFullYear();
    const tempLayoutWidth = updateLayout(1.0); // 使用基准比例计算小地图年份比例
    for (let y = minYear; y <= maxYear; y++) {
        const yearStart = new Date(y, 0, 1).getTime();
        // 只有当该年份刚好在我们的调整后时间范围内才显示
        if (yearStart >= adjustedMin && yearStart <= adjustedMax) {
            const yearX = timeToX(yearStart);
            const percent = (yearX / tempLayoutWidth) * 100;
            const yearEl = document.createElement('div');
            yearEl.className = 'timeline-minimap-year';
            yearEl.style.left = percent + '%';
            yearEl.innerText = y;
            document.getElementById('minimap-container').appendChild(yearEl);
        }
    }
    updateLayout(); // 恢复当前默认放大比例

    // 4. 排序并规划事件空间，绘制事件
    const tracksTop = [40, 100, 160, 220, 280]; 
    const tracksBottom = [40, 100, 160, 220, 280]; 
    events.sort((a,b) => parseDateStr(a.startDate) - parseDateStr(b.startDate));

    let placedTop = [];
    let placedBottom = [];

        let isDuration = false;
        let isTop = false;

        events.forEach((event, index) => {
            isDuration = event.type === 'duration';
            const start = parseDateStr(event.startDate);
            const startX = timeToX(start);

        // --- 绘制全局小地图 (Minimap) 要素 ---
        // 我们在布局函数外计算minimap，因为迷你地图反映的是整体相对位置（除非地图也要缩放，通常它只需要代表比例）
        let minimapStartPercent = 0, minimapEndPercent = 0;
        let minimapDuration = null;
        let minimapPoint = null;

        const baseTotalTrackWidth = totalTrackWidth / globalZoomScale; // 获取原始总比例基数
        const originalStartX = updateLayout(1.0) * (timeToX(start) / totalTrackWidth);
        updateLayout(); // 恢复当前缩放状态

        minimapStartPercent = (timeToX(start) / totalTrackWidth) * 100;
        
        if (isDuration) {
            const end = parseDateStr(event.endDate);
            minimapEndPercent = (timeToX(end) / totalTrackWidth) * 100;
            minimapDuration = document.createElement('div');
            minimapDuration.className = 'timeline-minimap-duration';
            minimapDuration.style.left = minimapStartPercent + '%';
            minimapDuration.style.width = (minimapEndPercent - minimapStartPercent) + '%';
            minimapTrack.appendChild(minimapDuration);
        } else {
            minimapPoint = document.createElement('div');
            minimapPoint.className = 'timeline-minimap-point';
            minimapPoint.style.left = minimapStartPercent + '%';
            minimapTrack.appendChild(minimapPoint);
        }

        // --- 绘制主轨道事件 ---
        const cardHTML = `
            <div class="timeline-time">${formatDate(event.startDate)}${isDuration && event.endDate ? ` 至 ${formatDate(event.endDate)}` : ''}</div>
            <div class="timeline-title">${event.title}</div>
            <div class="timeline-desc-container">
                <div class="timeline-desc">${event.description}</div>
                <div class="timeline-source">${event.source ? `<a href="${event.source}" target="_blank">查看来源</a>` : ''}</div>
            </div>
        `;

        // --- 决定上下排布位置与防重叠偏移距离 ---
        isDuration ? (isTop = false) : (isTop = true);
        
        let targetTracks = isTop ? tracksTop : tracksBottom;
        let placedEvents = isTop ? placedTop : placedBottom;
        
        // 计算预估的卡片占位宽度，220px 卡片宽 + 两侧安全边距 20px = 260px
        const cardWidth = 260; 
        const eventEndX = isDuration ? timeToX(parseDateStr(event.endDate)) : startX;
        // 卡片的中心位于 startX 或者是 (startX+endX)/2 （针对长期事件）
        const midX = isDuration ? startX + (eventEndX - startX) / 2 : startX;
        const cardLeft = midX - cardWidth / 2;
        const cardRight = midX + cardWidth / 2;

        let chosenTrackIndex = 0;
        while (true) {
            // 检查当前轨道是否有重叠
            const hasCollision = placedEvents.some(p => {
                return p.trackIndex === chosenTrackIndex && !(cardRight < p.left || cardLeft > p.right);
            });
            if (!hasCollision) {
                break;
            }
            chosenTrackIndex++;
        }

        placedEvents.push({
            trackIndex: chosenTrackIndex,
            left: cardLeft,
            right: cardRight
        });

        const marginOffset = 40 + chosenTrackIndex * 60;

        const card = document.createElement('div');
        card.className = `timeline-card ${isTop ? 'card-top' : 'card-bottom'}`;
        card.innerHTML = cardHTML;

        const connector = document.createElement('div');
        connector.className = 'timeline-connector';

        if (isDuration) {
            const end = parseDateStr(event.endDate);
            const endX = timeToX(end);
            const width = endX - startX;
            const midX = startX + width / 2;

            const bar = document.createElement('div');
            bar.className = 'timeline-event-duration';
            bar.style.left = startX + 'px';
            bar.style.width = width + 'px';
            // duration 事件的彩条也根据分配的轨道拉开足够的上下距离，避免同时发生时条有任何重叠
            bar.style.top = isTop ? `calc(50% - ${25 + chosenTrackIndex * 28}px)` : `calc(50% + ${5 + chosenTrackIndex * 28}px)`;
            bar.innerHTML = `<span class="timeline-event-duration-title">${event.title}</span>`;
            trackContainer.appendChild(bar);

            card.style.left = midX + 'px';
            connector.style.left = midX + 'px';

            if (isTop) {
                const barTopDist = 25 + chosenTrackIndex * 28;
                // 上方的事件：计算并固定其 bottom 边距，让卡片默认自然向上生长（滑动）
                card.style.bottom = `calc(50% + ${marginOffset + 30}px)`;
                // 连接线不再连接到时间轴 50%，而是连接到事件本身所在的彩色线条上
                connector.style.bottom = `calc(50% + ${barTopDist}px)`;
                connector.style.height = `${marginOffset + 30 - barTopDist}px`;
            } else {
                const barBottomDist = 25 + chosenTrackIndex * 28;
                // 下方的事件：计算并固定其 top 边距，让卡片默认自然向下生长（滑动）
                card.style.top = `calc(50% + ${marginOffset + 30}px)`;
                // 连接线不再连接到时间轴 50%，而是连接到事件本身所在的彩色线条上
                connector.style.top = `calc(50% + ${barBottomDist}px)`;
                connector.style.height = `${marginOffset + 30 - barBottomDist}px`;
            }
            
            trackContainer.appendChild(connector);
            trackContainer.appendChild(card);

            card.addEventListener('mouseenter', () => checkDescOverflow(card));
            card.addEventListener('mouseleave', () => card.style.transform = '');

            eventNodes.push({
                isDuration,
                start,
                end,
                bar, card, connector, minimapDuration,
                isTop, marginOffset,
                chosenTrackIndex
            });
            
            bar.addEventListener('mouseenter', () => {
                card.classList.add('hovered');
                checkDescOverflow(card);
            });
            bar.addEventListener('mouseleave', () => {
                card.classList.remove('hovered');
                card.style.transform = '';
            });
            
        } else {
            const point = document.createElement('div');
            point.className = 'timeline-event-point';
            point.style.left = startX + 'px';
            trackContainer.appendChild(point);

            card.style.left = startX + 'px';
            connector.style.left = startX + 'px';

            if (isTop) {
                card.style.bottom = `calc(50% + ${marginOffset}px)`;
                connector.style.bottom = '50%';
                connector.style.height = `${marginOffset}px`;
            } else {
                card.style.top = `calc(50% + ${marginOffset}px)`;
                connector.style.top = '50%';
                connector.style.height = `${marginOffset}px`;
            }

            trackContainer.appendChild(connector);
            trackContainer.appendChild(card);

            card.addEventListener('mouseenter', () => checkDescOverflow(card));
            card.addEventListener('mouseleave', () => card.style.transform = '');

            eventNodes.push({
                isDuration,
                start,
                point, card, connector, minimapPoint,
                isTop, marginOffset,
                chosenTrackIndex
            });
        }
    });

    // 5. 根据事件的时间重叠情况，独立计算 Minimap 上 Point（单点圆圈）的防重叠并动态分配高度
    const minimapPlacedPoints = [];
    const POINT_TIME_THRESHOLD = 30 * 24 * 60 * 60 * 1000; // 如果单点事件相差在30天以内，在小地图上就会分轨

    eventNodes.forEach(en => {
        if (!en.isDuration) {
            let trackIndex = 0;
            while(true) {
                const collision = minimapPlacedPoints.some(p => {
                    return p.trackIndex === trackIndex && Math.abs(p.start - en.start) < POINT_TIME_THRESHOLD;
                });
                if (!collision) break;
                trackIndex++;
            }
            en.minimapPointTrackIndex = trackIndex;
            minimapPlacedPoints.push({ trackIndex, start: en.start });
        }
    });

    const maxPointTrack = minimapPlacedPoints.length > 0 ? Math.max(...minimapPlacedPoints.map(p => p.trackIndex)) : 0;
    const pointLayerCount = minimapPlacedPoints.length > 0 ? maxPointTrack + 1 : 0;
    
    // 获取 Duration 的层级情况
    const maxBottomTrack = Math.max(0, ...placedBottom.map(p => p.trackIndex));
    const durationLayerCount = maxBottomTrack + 1;

    // Minimap 总高度为50px，我们留下大概44px的安全绘图区域 (上下各留出3px的padding)
    const availableHeight = 44; 
    // 单个 Point 圆圈默认需要的高度（6px直径 + 2px间距 = 8px）
    let pointVerticalSpace = 8; 
    let actualPointsHeight = pointLayerCount * pointVerticalSpace;
    
    // 自动压缩：如果单个时间由于重叠排不开，最多只占据上方约60%空间 (比如上限26px)
    if (actualPointsHeight > 26) {
        actualPointsHeight = 26;
        pointVerticalSpace = actualPointsHeight / pointLayerCount;
    }
    
    // 自动扩容：剩下的大量高度全部自动释放给 Duration 事件
    const remainingForDuration = availableHeight - actualPointsHeight;
    const durationSpacing = durationLayerCount > 0 ? remainingForDuration / durationLayerCount : 0;

    eventNodes.forEach(en => {
        if (en.minimapDuration) {
            // 设定宽容的高度
            en.minimapDuration.style.height = `${Math.max(2, durationSpacing - 1)}px`; 
            // 从下方空白处往下排
            const durationStartTop = 3 + actualPointsHeight;
            en.minimapDuration.style.top = `${durationStartTop + en.chosenTrackIndex * durationSpacing}px`;
        }
        if (en.minimapPoint) {
            // 根据给到的纵向空间自适应圆圈大小（最高能大到6px，最低小到3px）
            const ptDiameter = Math.max(3, Math.min(6, pointVerticalSpace * 0.8));
            en.minimapPoint.style.width = `${ptDiameter}px`;
            en.minimapPoint.style.height = `${ptDiameter}px`;
            // 圆点从最顶端空白处往下排
            const ptTop = 3 + en.minimapPointTrackIndex * pointVerticalSpace;
            en.minimapPoint.style.top = `${ptTop}px`;
        }
    });

    // 动态检查溢出：超出容器上下边界时进行滑动调整
    function checkDescOverflow(cardEl) {
        const descContainer = cardEl.querySelector('.timeline-desc-container');
        if (!descContainer) return;
        
        // 测量要展开内容的实际高度
        const scrollHeight = descContainer.scrollHeight;
        const cardRect = cardEl.getBoundingClientRect();
        const scrollAreaRect = scrollArea.getBoundingClientRect();

        const isTopCard = cardEl.classList.contains('card-top');
        
        if (isTopCard) {
            // 向上生长，检查是否超出了顶部
            const expectedTop = cardRect.top - scrollHeight;
            if (expectedTop < scrollAreaRect.top) {
                // 超出顶部了，向下滑动（translateY 为正）补回来
                let overflowOffset = scrollAreaRect.top - expectedTop + 15;
                // 做个保护限制（不能滑得太下方越过容器 bottom）
                if (cardRect.bottom + overflowOffset > scrollAreaRect.bottom) {
                    overflowOffset = scrollAreaRect.bottom - cardRect.bottom - 15;
                }
                if (overflowOffset > 0) {
                    cardEl.style.transform = `translate(-50%, ${overflowOffset}px)`;
                }
            }
        } else {
            // 向下生长，检查是否超出了底部
            const expectedBottom = cardRect.bottom + scrollHeight;
            if (expectedBottom > scrollAreaRect.bottom) {
                // 超出底部了，向上滑动（translateY 为负）补回来
                let overflowOffset = expectedBottom - scrollAreaRect.bottom + 15; 
                // 做个保护限制（不能滑得太上方越过容器 top）
                if (cardRect.top - overflowOffset < scrollAreaRect.top) {
                    overflowOffset = cardRect.top - scrollAreaRect.top - 15;
                }
                if (overflowOffset > 0) {
                    cardEl.style.transform = `translate(-50%, -${overflowOffset}px)`;
                }
            }
        }
    }

    // ============================================
    // 动态布局缩放核心功能
    // ============================================
    function renderLayout() {
        const newTotalWidth = updateLayout();

        // 重新摆放刻度线并根据缩放比例动态更新标签显示
        tickNodes.forEach(node => {
            const mb = monthBlocks[node.monthIndex];
            node.element.style.left = mb.x + 'px';
            
            // 获取里面真实的 label div
            const labelEl = node.labelEl || node.element.querySelector('.timeline-tick-label');
            labelEl.style.whiteSpace = 'pre'; // 支持换行或br
            
            updateTickLabels(node);
        });

        // 重新摆放所有事件、短连接线和卡片
        eventNodes.forEach(en => {
            const sx = timeToX(en.start);
            if (en.isDuration) {
                const ex = timeToX(en.end);
                const w = ex - sx;
                const mX = sx + w / 2;
                en.bar.style.left = sx + 'px';
                en.bar.style.width = w + 'px';
                en.card.style.left = mX + 'px';
                en.connector.style.left = mX + 'px';
            } else {
                en.point.style.left = sx + 'px';
                en.card.style.left = sx + 'px';
                en.connector.style.left = sx + 'px';
            }
        });

        updateViewportUI();
    }

    // 在 minimap-container 右边或上边加入放大缩小的控制按钮
    const controlsContainer = document.createElement('div');
    controlsContainer.className = 'timeline-zoom-controls';
    controlsContainer.innerHTML = `
        <button id="zoom-in" title="放大时间线">+</button>
        <button id="zoom-out" title="缩小时间线">-</button>
        <span id="zoom-label">100%</span>
    `;
    minimapContainer.after(controlsContainer);

    document.getElementById('zoom-in').addEventListener('click', () => {
        if (globalZoomScale < 3.0) {
            globalZoomScale += 0.2;
            document.getElementById('zoom-label').innerText = Math.round(globalZoomScale * 100) + '%';
            renderLayout();
        }
    });

    document.getElementById('zoom-out').addEventListener('click', () => {
        if (globalZoomScale > 0.4) {
            globalZoomScale -= 0.2;
            document.getElementById('zoom-label').innerText = Math.round(globalZoomScale * 100) + '%';
            renderLayout();
        }
    });

    // 5. 交互：同步 Scroll 与 Minimap
    function updateViewportUI() {
        const scrollWidth = scrollArea.scrollWidth;
        const clientWidth = scrollArea.clientWidth;
        const scrollLeft = scrollArea.scrollLeft;

        // 如果内容不够滚动，占比就是 100%
        const widthPercent = Math.min((clientWidth / scrollWidth) * 100, 100);
        const leftPercent = (scrollLeft / scrollWidth) * 100;

        viewport.style.width = widthPercent + '%';
        viewport.style.left = leftPercent + '%';
    }

    // 确保DOM渲染完成后初始化 Viewport
    setTimeout(updateViewportUI, 0);

    scrollArea.addEventListener('scroll', updateViewportUI);
    window.addEventListener('resize', updateViewportUI);

    // 6. 交互：拖拽 Viewport 控制 Scroll
    let isDragging = false;
    let dragStartX = 0;
    let startScrollLeft = 0;

    viewport.addEventListener('mousedown', (e) => {
        isDragging = true;
        dragStartX = e.clientX;
        startScrollLeft = scrollArea.scrollLeft;
        document.body.style.userSelect = 'none'; // 防止拖拽时选中文本
    });

    window.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        const deltaX = e.clientX - dragStartX;
        const minimapWidthPx = minimapContainer.clientWidth;
        
        // 计算移动距离占小地图总宽度的百分比
        const deltaPercent = deltaX / minimapWidthPx;
        
        // 映射到主轨道的像素滚动量
        const scrollDelta = deltaPercent * scrollArea.scrollWidth;
        scrollArea.scrollLeft = startScrollLeft + scrollDelta;
    });

    window.addEventListener('mouseup', () => {
        if (isDragging) {
            isDragging = false;
            document.body.style.userSelect = '';
        }
    });

    // 7. 交互：点击 Minimap 其他区域快速跳转
    minimapContainer.addEventListener('mousedown', (e) => {
        if (e.target === viewport) return; // 单独交给 viewport 拖拽处理
        
        // 获取点击的位置百分比
        const rect = minimapContainer.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const clickPercent = clickX / minimapContainer.clientWidth;
        
        // 计算想把 Viewport 中心移动过去的目标 ScrollLeft
        const clientWidth = scrollArea.clientWidth;
        const scrollWidth = scrollArea.scrollWidth;
        
        let targetScrollLeft = (clickPercent * scrollWidth) - (clientWidth / 2);
        
        // 限制边界
        if (targetScrollLeft < 0) targetScrollLeft = 0;
        if (targetScrollLeft + clientWidth > scrollWidth) {
            targetScrollLeft = scrollWidth - clientWidth;
        }

        scrollArea.scrollTo({
            left: targetScrollLeft,
            behavior: 'smooth'
        });
    });

    // 8. 初始化：默认滚动到时间线的最右侧（最新事件）
    // 使用 requestAnimationFrame 或 setTimeout 确保 DOM 已经完成渲染和宽度的计算
    setTimeout(() => {
        if (scrollArea.scrollWidth > scrollArea.clientWidth) {
            scrollArea.scrollLeft = scrollArea.scrollWidth;
            updateViewportUI();
        }
    }, 50);
}
