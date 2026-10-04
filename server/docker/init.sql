-- 初始化脚本：仅容器首次创建数据卷时执行
CREATE DATABASE IF NOT EXISTS jizhang CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE IF NOT EXISTS jizhang_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
GRANT ALL PRIVILEGES ON jizhang.* TO 'jizhang'@'%';
GRANT ALL PRIVILEGES ON jizhang_test.* TO 'jizhang'@'%';
FLUSH PRIVILEGES;
