"""Source labels -> the app's categories (clothing_analysis.CATEGORIES). None where a label is ambiguous:
a missing example costs less than a wrong one."""
import re


def has(text, *words):
    return any(re.search(r'\b' + w, text) for w in words)


def top_by_words(t):
    if has(t, 'turtleneck', 'turtle neck', 'roll neck', 'roll-neck', 'polo neck', 'polo-neck', 'mock neck', 'high neck', 'funnel neck'):
        return 'Водолазка'
    if has(t, 'hoodie', 'hooded'):
        return 'Худи'
    if has(t, 'sweatshirt'):
        return 'Свитшот'
    if has(t, 'cardigan'):
        return 'Кардиган'
    if has(t, 'sweater', 'jumper', 'pullover', 'knit'):
        return 'Свитер'
    if has(t, 'polo'):
        return 'Поло'
    if has(t, 'blouse'):
        return 'Блуза'
    if has(t, 'shirt') and not has(t, 't-shirt', 'tshirt', 'tee', 'sweatshirt'):
        return 'Рубашка'
    if has(t, 'crop'):
        return 'Топ'
    if has(t, 'tank', 'cami', 'vest top', 'singlet'):
        return 'Майка'
    if has(t, 't-shirt', 'tshirt', 'tee'):
        return 'Лонгслив' if has(t, 'long sleeve', 'long-sleeve', 'longsleeve', 'full sleeve') else 'Футболка'
    return None


def outer_by_words(t, default=None):
    if has(t, 'fur', 'faux fur', 'shearling coat', 'cape', 'poncho', 'gilet', 'vest'):
        return None
    if has(t, 'trench'):
        return 'Тренч'
    if has(t, 'parka', 'anorak'):
        return 'Парка'
    if has(t, 'puffer', 'down jacket', 'down coat', 'quilted', 'padded', 'puffa'):
        return 'Пуховик'
    if has(t, 'raincoat', 'rain coat', 'rain jacket', 'mac\b', 'mackintosh'):
        return 'Плащ'
    if has(t, 'bomber'):
        return 'Бомбер'
    if has(t, 'blazer', 'suit jacket', 'tuxedo jacket', 'sportcoat', 'sport coat'):
        return 'Пиджак'
    if has(t, 'coat') and not has(t, 'coated'):
        return 'Пальто'
    if has(t, 'jacket', 'biker', 'moto'):
        return 'Куртка'
    return default


def pants_by_words(t, default='Брюки'):
    if has(t, 'jogger', 'sweatpant', 'track pant', 'trackpant', 'track bottom', 'sweat pant'):
        return 'Джоггеры'
    if has(t, 'legging', 'jegging'):
        return 'Леггинсы'
    if has(t, 'jean', 'denim'):
        return 'Джинсы'
    if has(t, 'short'):
        return None
    return default


def shoes_by_words(t):
    if has(t, 'boot', 'bootie'):
        if has(t, 'knee', 'over-the-knee', 'thigh', 'tall', 'riding'):
            return 'Сапоги'
        return 'Ботинки'
    if has(t, 'sandal', 'slide', 'flip flop', 'espadrille sandal'):
        return 'Сандалии'
    if has(t, 'loafer', 'moccasin'):
        return 'Лоферы'
    if has(t, 'ballet', 'ballerina'):
        return 'Балетки'
    if has(t, 'converse', 'chuck', 'canvas', 'plimsoll', 'vans'):
        return 'Кеды'
    if has(t, 'sneaker', 'trainer', 'running', 'runner'):
        return 'Кроссовки'
    if has(t, 'pump', 'stiletto', 'oxford', 'derby', 'brogue', 'heel'):
        return 'Туфли'
    return None


def hat_by_words(t):
    if has(t, 'beanie', 'knit hat', 'knitted hat', 'pom', 'bobble', 'ski hat', 'winter hat'):
        return 'Шапка'
    if has(t, 'baseball', 'trucker', 'snapback', 'cap'):
        return 'Кепка'
    if has(t, 'fedora', 'panama', 'sun hat', 'straw', 'wide brim', 'wide-brim', 'boater', 'cowboy', 'bucket', 'trilby', 'floppy', 'cloche'):
        return 'Шляпа'
    return None


def bag_by_words(t, default='Сумка'):
    if has(t, 'backpack', 'rucksack'):
        return 'Рюкзак'
    if has(t, 'clutch'):
        return 'Клатч'
    if has(t, 'wallet', 'purse organiser', 'luggage', 'suitcase', 'laptop'):
        return None
    return default


def polyvore(category, text):
    c, t = category, (text or '').lower()
    men = c.startswith("Men's ")
    base = c[6:] if men else c
    if base in ('T-Shirts',):
        return 'Поло' if has(t, 'polo') else 'Лонгслив' if has(t, 'long sleeve', 'long-sleeve') else 'Футболка'
    if base in ('Polos',):
        return 'Поло'
    if base in ('Tops', 'Activewear Tops', 'Tunics'):
        return top_by_words(t)
    if base in ('Tank Tops', 'Activewear Tank Tops', 'Camisoles'):
        return 'Топ' if has(t, 'crop') else 'Майка'
    if base == 'Blouses':
        return 'Блуза'
    if base in ('Casual Shirts', 'Dress Shirts', 'Shirts'):
        return 'Рубашка'
    if base == 'Sweaters':
        return {'Водолазка': 'Водолазка', 'Кардиган': 'Кардиган'}.get(top_by_words(t), 'Свитер')
    if base == 'Cardigans':
        return 'Кардиган'
    if base == 'Sweatshirts':
        return 'Худи' if has(t, 'hood') else 'Свитшот'
    if base == 'Hoodies':
        return 'Худи'
    if base == 'Vests':
        return None if has(t, 'puffer', 'down', 'quilted', 'padded', 'fur') else 'Жилет'
    if base in ('Blazers', 'Sportcoats & Blazers'):
        return 'Пиджак'
    if base in ('Jackets', 'Activewear Jackets', 'Outerwear'):
        return outer_by_words(t, 'Куртка')
    if base == 'Coats':
        return outer_by_words(t, 'Пальто')
    if base in ('Day Dresses', 'Cocktail Dresses', 'Dresses', 'Gowns', 'Wedding Dresses'):
        return 'Сарафан' if has(t, 'sundress', 'sun dress') else 'Платье'
    if base in ('Jumpsuits', 'Rompers'):
        return 'Комбинезон'
    if 'Skirts' in base:
        return 'Юбка'
    if 'Jeans' in base:
        return 'Джинсы'
    if base in ('Pants', 'Casual Pants', 'Dress Pants', 'Capri & Cropped Pants'):
        return pants_by_words(t)
    if base == 'Activewear Pants':
        return pants_by_words(t, None)
    if base == 'Leggings':
        return 'Леггинсы'
    if base in ('Shorts', 'Activewear Shorts'):
        return 'Шорты'
    if base in ('Tights', 'Hosiery'):
        return 'Колготки'
    if base in ('Sneakers', 'Athletic Shoes'):
        return 'Кеды' if has(t, 'converse', 'chuck', 'canvas', 'plimsoll', 'vans') else 'Кроссовки'
    if base == 'Pumps':
        return 'Туфли'
    if base in ('Dress Shoes', 'Oxfords'):
        return 'Туфли'
    if base == 'Loafers & Moccasins':
        return 'Лоферы'
    if base == 'Ankle Booties':
        return 'Ботинки'
    if base in ('Knee High Boots', 'Over-The-Knee Boots'):
        return 'Сапоги'
    if base in ('Boots', 'Work Boots'):
        return 'Сапоги' if has(t, 'knee', 'over-the-knee', 'thigh', 'tall', 'riding') else 'Ботинки' if has(t, 'ankle', 'chelsea', 'combat', 'bootie', 'lace-up', 'lace up', 'chukka', 'desert', 'work boot', 'hiking') or men else None
    if base == 'Sandals':
        return 'Сандалии'
    if base == 'Flats':
        return 'Балетки' if not has(t, 'sandal', 'mule', 'loafer', 'slipper', 'slide', 'espadrille', 'oxford', 'sneaker', 'moccasin') else None
    if base == 'Hats':
        return hat_by_words(t)
    if base == 'Scarves':
        return 'Шарф'
    if base == 'Gloves':
        return 'Перчатки'
    if base in ('Shoulder Bags', 'Handbags', 'Tote Bags', 'Messenger Bags', 'Bags'):
        return bag_by_words(t)
    if base == 'Backpacks':
        return 'Рюкзак'
    if base == 'Clutches':
        return 'Клатч'
    return None


def fashion200k(c1, c2, c3, text):
    t = f'{c3 or ""} {text or ""}'.lower()
    words3 = (c3 or '').lower()
    if c1 == 'dresses':
        return 'Сарафан' if has(words3, 'sundress', 'sun dress') else 'Платье'
    if c1 == 'skirts':
        return 'Юбка'
    if c2 == 'leggings':
        return 'Леггинсы'
    if c2 == 'shirts':
        return 'Рубашка'
    if c2 == 'blouses':
        return 'Блуза'
    if c2 == 't-shirts':
        return 'Лонгслив' if has(words3, 'long sleeve', 'long-sleeve') else 'Поло' if has(words3, 'polo') else 'Футболка'
    if c2 in ('short sleeve tops', 'long sleeved tops', 'sleeveless and tank tops'):
        found = top_by_words(words3)
        if found in ('Футболка', 'Лонгслив'):
            return 'Лонгслив' if c2 == 'long sleeved tops' else 'Футболка'
        return found
    if c2 == 'blazers and suit jackets':
        return 'Пиджак'
    if c2 == 'padded and down jackets':
        return None if has(words3, 'gilet', 'vest') else 'Парка' if has(words3, 'parka') else 'Пуховик'
    if c2 in ('leather jackets', 'casual jackets', 'denim jackets'):
        return outer_by_words(words3, 'Куртка')
    if c2 == 'waistcoats and gilets':
        return None if has(words3, 'padded', 'quilted', 'down', 'puffer', 'fur') else 'Жилет'
    if c1 == 'pants':
        return pants_by_words(words3)
    return None


def product(article, name):
    a, t = article, (name or '').lower()
    if a == 'Tshirts':
        return 'Поло' if has(t, 'polo') else 'Лонгслив' if has(t, 'full sleeve', 'long sleeve') else 'Футболка'
    if a == 'Shirts':
        return 'Рубашка'
    if a == 'Tops':
        return top_by_words(t)
    if a in ('Camisoles', 'Innerwear Vests'):
        return 'Майка'
    if a == 'Sweatshirts':
        return 'Худи' if has(t, 'hood') else 'Свитшот'
    if a == 'Sweaters':
        return {'Водолазка': 'Водолазка', 'Кардиган': 'Кардиган'}.get(top_by_words(t), 'Свитер')
    if a == 'Jackets':
        return outer_by_words(t, 'Куртка')
    if a == 'Blazers':
        return 'Пиджак'
    if a == 'Waistcoat':
        return 'Жилет'
    if a == 'Rain Jacket':
        return 'Плащ'
    if a == 'Dresses':
        return 'Платье'
    if a in ('Jumpsuit', 'Rompers'):
        return 'Комбинезон'
    if a == 'Skirts':
        return 'Юбка'
    if a == 'Jeans':
        return 'Джинсы'
    if a == 'Trousers':
        return pants_by_words(t)
    if a in ('Track Pants', 'Lounge Pants'):
        return 'Джоггеры'
    if a == 'Shorts':
        return 'Шорты'
    if a in ('Leggings', 'Jeggings'):
        return 'Леггинсы'
    if a in ('Tights', 'Stockings'):
        return 'Колготки'
    if a == 'Sports Shoes':
        return 'Кроссовки'
    if a in ('Casual Shoes', 'Formal Shoes', 'Flats', 'Heels'):
        return shoes_by_words(t) or ('Туфли' if a in ('Formal Shoes', 'Heels') else None)
    if a in ('Sandals', 'Sports Sandals'):
        return 'Сандалии'
    if a == 'Booties':
        return 'Ботинки'
    if a == 'Handbags':
        return bag_by_words(t)
    if a == 'Clutches':
        return 'Клатч'
    if a in ('Backpacks', 'Rucksacks'):
        return 'Рюкзак'
    if a == 'Caps':
        return 'Кепка'
    if a == 'Hat':
        return 'Шляпа'
    if a in ('Scarves', 'Stoles', 'Mufflers'):
        return 'Шарф'
    if a == 'Gloves':
        return 'Перчатки'
    return None


def atlas(sub, text):
    t = (text or '').lower()
    if sub in ('Shirts', 'Formal Shirts'):
        return 'Рубашка'
    if sub == 'Tops&Tees':
        return top_by_words(t)
    if sub == 'Sweatshirts&Hoodies':
        return 'Худи' if has(t, 'hood') else 'Свитшот' if has(t, 'sweatshirt') else None
    if sub == 'Blazers&Suits':
        return 'Пиджак' if has(t, 'blazer') and not has(t, 'suit') else None
    if sub == 'Jeans':
        return 'Джинсы'
    if sub in ('Trousers', 'Pants&Trousers', 'Cargos'):
        return pants_by_words(t)
    if sub == 'Shorts':
        return 'Шорты'
    if sub == 'Jackets':
        return outer_by_words(t, 'Куртка')
    if sub == 'Tracks&Joggers':
        return 'Джоггеры'
    if sub == 'Jacket&Shrugs&Cardigans':
        return 'Кардиган' if has(t, 'cardigan') else outer_by_words(t)
    if sub == 'Dungarees':
        return 'Комбинезон'
    if sub == 'Skirts':
        return 'Юбка'
    return None


POLYVORE_SLOTS = {'Tops': '?Верх', 'Tunics': '?Верх', 'Activewear Tops': '?Верх', 'Boots': '?Обувь', 'Mid Calf Boots': '?Обувь',
                  'Shoes': '?Обувь', 'Flats': '?Обувь', 'Clogs': '?Обувь', 'Men\'s Shoes': '?Обувь', 'Men\'s Boots': '?Обувь',
                  'Hats': '?Аксессуары', 'Men\'s Hats': '?Аксессуары', 'Activewear Pants': '?Низ', 'Men\'s Activewear Pants': '?Низ'}


def polyvore_any(category, text):
    """The category, or only the slot ('?Верх') when the label tells the role but not the kind: enough for outfits."""
    return polyvore(category, text) or POLYVORE_SLOTS.get(category)
