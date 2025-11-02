import sys
import os
import json
from PyQt6.QtWidgets import (
    QApplication, QWidget, QFormLayout, 
    QLineEdit, QComboBox, QPlainTextEdit, 
    QPushButton, QVBoxLayout, QHBoxLayout, 
    QLabel, QMessageBox
)
from PyQt6.QtCore import Qt
from PyQt6.QtGui import QFont, QPalette, QColor

class MatrixFileCreator(QWidget):
    """Приложение PyQt6 для создания файлов инструкций в формате JSON."""

    def __init__(self):
        super().__init__()
        self.setWindowTitle("PhoneGuide — ADD.PY [MATRIX]")
        self.setGeometry(100, 100, 600, 700)
        
        self.apply_matrix_theme()
        self.init_ui()

    def apply_matrix_theme(self):
        """Настройка темной палитры в стиле Матрицы."""
        # Устанавливаем общую темную палитру
        palette = QPalette()
        palette.setColor(QPalette.ColorRole.Window, QColor(6, 7, 9))
        palette.setColor(QPalette.ColorRole.WindowText, QColor(34, 255, 136)) # accent-green
        palette.setColor(QPalette.ColorRole.Base, QColor(15, 20, 22))
        palette.setColor(QPalette.ColorRole.AlternateBase, QColor(12, 14, 16))
        palette.setColor(QPalette.ColorRole.ToolTipBase, QColor(6, 7, 9))
        palette.setColor(QPalette.ColorRole.ToolTipText, QColor(34, 255, 136))
        palette.setColor(QPalette.ColorRole.Text, QColor(234, 255, 239))
        palette.setColor(QPalette.ColorRole.Button, QColor(15, 20, 22))
        palette.setColor(QPalette.ColorRole.ButtonText, QColor(234, 255, 239))
        palette.setColor(QPalette.ColorRole.BrightText, QColor(255, 255, 255))
        palette.setColor(QPalette.ColorRole.Highlight, QColor(22, 255, 136)) # Green highlight
        palette.setColor(QPalette.ColorRole.HighlightedText, QColor(6, 7, 9))
        self.setPalette(palette)

        # Общий стиль для всех элементов, имитирующий консольный шрифт и свечение
        font = QFont("Consolas", 10)
        self.setFont(font)
        
        # Дополнительный CSS для свечения и акцентов
        self.setStyleSheet("""
            QWidget {
                color: #eaffef;
                background-color: #060709;
            }
            QLabel {
                color: #22ff88;
                font-weight: bold;
            }
            QLineEdit, QPlainTextEdit, QComboBox {
                background: #0f1416;
                border: 1px solid #16d67a;
                padding: 5px;
                border-radius: 4px;
                color: #eaffef;
                font-family: 'Consolas', monospace;
            }
            QComboBox::drop-down {
                border-left: 1px solid #16d67a;
            }
            QPushButton {
                background-color: #22ff88;
                color: #060709;
                border: none;
                padding: 10px;
                font-weight: bold;
                border-radius: 6px;
                box-shadow: 0 0 10px rgba(34, 255, 136, 0.6);
            }
            QPushButton:hover {
                background-color: #16d67a;
                box-shadow: 0 0 15px rgba(34, 255, 136, 1.0);
            }
        """)

    def init_ui(self):
        """Инициализация элементов интерфейса."""
        
        main_layout = QVBoxLayout()
        form_layout = QFormLayout()

        # 1. Выбор/Указание Бренда (QComboBox с возможностью ввода)
        self.brand_combo = QComboBox()
        self.brand_combo.setEditable(True)
        # Пример популярных брендов для быстрого выбора
        self.brand_combo.addItems(["xiaomi", "samsung", "huawei", "realme", "infinix", "tecno", "oppo"])
        self.brand_combo.setCurrentText("") # Оставляем поле пустым для первого ввода
        form_layout.addRow(QLabel("1. Бренд (Brand):"), self.brand_combo)

        # 2. Модель (QLineEdit)
        self.model_input = QLineEdit()
        self.model_input.setPlaceholderText("Например: Redmi Note 10 Pro или SM-A505F")
        form_layout.addRow(QLabel("2. Модель (Model):"), self.model_input)
        
        # 3. Процессор (QLineEdit)
        self.cpu_input = QLineEdit()
        self.cpu_input.setPlaceholderText("Например: MTK, QCOM, Exynos")
        form_layout.addRow(QLabel("3. Процессор (CPU):"), self.cpu_input)
        
        # 4. Кодовое имя (QLineEdit)
        self.codename_input = QLineEdit()
        self.codename_input.setPlaceholderText("Например: sweet (если есть), можно оставить пустым")
        form_layout.addRow(QLabel("4. Кодовое имя (Codename):"), self.codename_input)

        # 5. Проблема (QComboBox)
        self.issue_combo = QComboBox()
        self.issue_combo.addItems(["imei", "frp", "dead"])
        form_layout.addRow(QLabel("5. Проблема (Issue):"), self.issue_combo)

        main_layout.addLayout(form_layout)

        # 6. Инструкции/Решение (QPlainTextEdit)
        main_layout.addWidget(QLabel("6. Инструкции (Instructions):"))
        self.instructions_input = QPlainTextEdit()
        self.instructions_input.setPlaceholderText("Введите здесь подробное решение проблемы. Можно использовать переносы строк.")
        self.instructions_input.setFixedHeight(300)
        main_layout.addWidget(self.instructions_input)

        # 7. Кнопка сохранения
        self.save_button = QPushButton("[//] Создать Файл Инструкций [//]")
        self.save_button.clicked.connect(self.save_file)
        main_layout.addWidget(self.save_button)

        self.setLayout(main_layout)

    def sanitize_for_path(self, text):
        """Очищает текст для использования в именах файлов и путях."""
        if not text:
            return ""
        text = text.lower().strip()
        # Заменяем небезопасные символы, кроме дефиса
        text = text.replace(' ', '_').replace('/', '_')
        # Удаляем все, что не является буквой, цифрой, '_' или '-'
        text = ''.join(c for c in text if c.isalnum() or c in ['_', '-'])
        return text

    def save_file(self):
        """Собирает данные, создает JSON-файл и сохраняет его в нужную папку."""
        
        # 1. Сбор и валидация данных
        brand = self.brand_combo.currentText().strip()
        model = self.model_input.text().strip()
        cpu = self.cpu_input.text().strip()
        codename = self.codename_input.text().strip()
        issue = self.issue_combo.currentText()
        instructions = self.instructions_input.toPlainText().strip()

        if not brand or not model or not instructions:
            QMessageBox.warning(self, "Ошибка ввода", 
                                "Поля 'Бренд', 'Модель' и 'Инструкции' обязательны для заполнения.")
            return

        # 2. Санитизация для пути к файлу
        brand_san = self.sanitize_for_path(brand)
        model_san = self.sanitize_for_path(model)
        codename_san = self.sanitize_for_path(codename)
        
        # Проверка, что санитизация не привела к пустым строкам
        if not brand_san or not model_san:
            QMessageBox.critical(self, "Ошибка санитизации", 
                                 "Бренд или Модель содержат недопустимые символы. Пожалуйста, используйте латиницу/цифры.")
            return

        # 3. Формирование пути
        base_dir = "data/phones_db"
        
        # Директория: data/phones_db/brand
        dir_path = os.path.join(base_dir, brand_san)
        
        # Имя файла: model[-codename]-issue.json
        filename_parts = [model_san]
        if codename_san:
            filename_parts.append(codename_san)
        filename_parts.append(issue)
        
        filename = f"{'-'.join(filename_parts)}.json"
        full_path = os.path.join(dir_path, filename)

        # 4. Формирование JSON-контента
        data = {
            "brand": brand,
            "model": model,
            "codename": codename,
            "cpu": cpu,
            "issue": issue,
            "instructions": instructions
        }

        try:
            # 5. Создание директории, если она не существует
            os.makedirs(dir_path, exist_ok=True)
            
            # 6. Запись файла
            with open(full_path, 'w', encoding='utf-8') as f:
                json.dump(data, f, ensure_ascii=False, indent=2)

            # 7. Сообщение об успехе
            QMessageBox.information(self, "Успех!", 
                                    f"Файл успешно создан:\n\n[PATH] {full_path}")
            
            # Очистка полей для следующего ввода (опционально)
            self.model_input.clear()
            self.cpu_input.clear()
            self.codename_input.clear()
            self.instructions_input.clear()
            
        except Exception as e:
            QMessageBox.critical(self, "Ошибка сохранения", 
                                 f"Не удалось записать файл:\n{e}")

if __name__ == '__main__':
    app = QApplication(sys.argv)
    window = MatrixFileCreator()
    window.show()
    sys.exit(app.exec())