import { Injectable } from '@nestjs/common';
import { User } from 'src/user/entities/user.entity';
import { Repository, EntityNotFoundError, EntityManager, In } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { CreateCollectionDto } from './dto/create-collection.dto';
import { Collection } from './entities/collection.entity';
import {
  TooManyCollectionException,
  TooManyCollectionItemException,
  PermissionDenied,
} from 'src/common/exception/service.exception';
import { EntityNotFoundException } from 'src/common/exception/service.exception';
import { CollectionItem } from './entities/collection-item.entity';
import { Wata } from 'src/admin/wata/entities/wata.entity';
import { WataLabelType } from 'src/admin/wata/interface/wata.type';

@Injectable()
export class CollectionService {
  constructor(
    @InjectRepository(Collection)
    private readonly collectionRepository: Repository<Collection>,
    @InjectRepository(CollectionItem)
    private readonly collectionItemRepository: Repository<CollectionItem>,
    @InjectRepository(Wata)
    private readonly wataRepository: Repository<Wata>,
    // private readonly wataService: WataService,
    private readonly entityManager: EntityManager,
    private readonly configService: ConfigService,
  ) {}

  private readonly sqids = new Sqids({
    alphabet: this.configService.get('SQIDS_AlPHABET'),
    minLength: 4,
  });

  private async whiteSpaceCheck(createCollectionDto: CreateCollectionDto) {
    let note = createCollectionDto.note;
    if (note !== null && note !== undefined) {
      note = note.replaceAll(' ', '');

      if (note === '') {
        return 'Y';
      }
    }
  }

  private async userCheck(user: User, id: number) {
    const result = await this.collectionRepository
      .createQueryBuilder('collection')
      .leftJoinAndSelect('collection.adder', 'adder')
      .where('collection.id = :id', { id: id })
      .select(['adder.id'])
      .getRawOne();

    if (user.id !== result.adder_id) {
      throw PermissionDenied();
    }
  }

  async createCollection(user: User, createCollectionDto: CreateCollectionDto) {
    // 컬렉션 생성 개수 제한 검사
    const collecionCount = await this.collectionRepository.count({
      where: { adder: { id: user.id } },
    });
    if (collecionCount >= COLLECTIONS_LIMMIT_COUNT) {
      throw TooManyCollectionException();
    }

    const createCollection = this.collectionRepository.create({
      title: createCollectionDto.title,
      note: createCollectionDto.note,
      adder: user,
      updater: user,
    } as Collection);

    const added = await this.collectionRepository.save(createCollection);

    return {
      ...added,
      shared_id: this.getSharedId(added.id),
    };
  }

  async findCollections(user: User) {
    try {
      const result = await this.collectionRepository.find({
        select: {
          id: true,
          title: true,
          note: true,
          items: {
            id: true,
            wata: {
              id: true,
            },
          },
        },
        where: { adder: { id: user.id } },
        relations: {
          items: {
            wata: true,
          },
        },
        order: {
          created_at: 'ASC',
        },
      });

      //조회용 암호화된 id 추가
      const result = [];
      total.forEach((collection) => {
        const encryptedText = this.encrypt.encrypt(collection.id);
        result.push(CollectionListResponseDto.of(collection, encryptedText));
      });

      return {
        total_count: totalCount,
        result: result,
      };
    } catch (error) {
      if (error instanceof EntityNotFoundError) {
        throw EntityNotFoundException();
      } else {
        throw error;
      }
    }
  }

  async findShareCollection(sharedId: string) {
    try {
      //collection_id 복호화
      const collection_id = this.sqids.decode(sharedId)[0];

      // collection info
      const result = await this.collectionRepository.findOneOrFail({
        select: {
          id: true,
          title: true,
          note: true,
          items: {
            id: true,
            wata: {
              id: true,
            },
          },
        },
        where: { id: collection_id },
        relations: {
          items: {
            wata: true,
          },
        },
      });

      return {
        id: result.id,
        shared_id: sharedId,
        title: result.title,
        note: result.note,
        items: result?.items?.map((item) => item?.wata?.id),
      };
    } catch (error) {
      if (error instanceof EntityNotFoundError) {
        throw EntityNotFoundException();
      } else {
        throw error;
      }
    }
  }

  async findCollectionInfo(id: number) {
    try {
      const collection = await this.collectionRepository.findOneOrFail({
        where: { id },
      });

      return collection;
    } catch (error) {
      if (error instanceof EntityNotFoundError) {
        throw EntityNotFoundException();
      } else {
        throw error;
      }
    }
  }

  async findAllItems(findCollectionDto: FindCollectionDto) {
    try {
      //collection_id 복호화
      const collection_id = Number(this.encrypt.decrypt(findCollectionDto.id));

      const [collectionItems, totalCount] =
        await this.collectionItemRepository.findAndCount({
          where: {
            collection: { id: collection_id },
          },
          relations: { wata: true },
          select: ['id', 'wata', 'created_at'],
          skip: findCollectionDto.getSkip(),
          take: findCollectionDto.getTake(),
          order: {
            created_at: 'DESC',
          },
        });

      return [collectionItems.map((row) => row.wata.id), totalCount];
    } catch (error) {
      if (error instanceof EntityNotFoundError) {
        throw EntityNotFoundException();
      } else {
        throw error;
      }
    }
  }

  async updateCollection(id: number, updateCollectionDto: CreateCollectionDto) {
    await this.findCollectionInfo(id);

    return this.collectionRepository.save({ id, ...updateCollectionDto });
  }

  async removeCollection(id: number) {
    await this.findCollectionInfo(id);

    return this.entityManager.transaction(
      async (transactionalEntityManager) => {
        const criteria = { collection: { id } };
        await transactionalEntityManager.delete(CollectionItem, criteria);
        await transactionalEntityManager.delete(Collection, criteria);

        return id;
      },
    );
  }

  async addItem(adder: User, collection_id: number, addIds: number[]) {
    await this.checkPermission(adder, collection_id);

    const totalCount = await this.collectionItemRepository.count({
      relations: { collection: true, wata: true },
      where: { collection: { id: collection_id } },
    });

    if (totalCount >= 200) {
      throw TooManyCollectionItemException();
    }

    try {
      const saveEntities: CollectionItem[] = [];
      for (const id of addIds) {
        const addItem = this.collectionItemRepository.create({
          collection: { id: collection_id } as Collection,
          wata: { id: id } as Wata,
          adder: adder,
          updater: adder,
        });

        saveEntities.push(addItem);
      }
      return this.collectionItemRepository.save(saveEntities);
    } catch (error) {
      if (error instanceof EntityNotFoundError) {
        throw EntityNotFoundException();
      } else {
        throw error;
      }
    }
  }

  async removeItem(collection_id: number, remover: User, deleteIds: number[]) {
    await this.checkPermission(remover, collection_id);

    try {
      const deletId: number[] = [];
      for (const id of deleteIds) {
        const collection_item =
          await this.collectionItemRepository.findOneOrFail({
            where: {
              collection: { id: collection_id },
              wata: { id: id } as Wata,
            },
          });

        deletId.push(collection_item.id);
      }

      return this.collectionItemRepository.delete(deletId);
    } catch (error) {
      if (error instanceof EntityNotFoundError) {
        throw EntityNotFoundException();
      } else {
        throw error;
      }
    }
  }

  async updateItem(updater: User, updateItems: UpdateItemDto[]) {
    let collectionIds = updateItems.map((item) => item.collection_id);
    collectionIds = [...new Set(collectionIds)];

    await this.checkPermission(updater, collectionIds);

    const addItems: CollectionItem[] = [];
    let isDelete = false;

    const deleteQueryBuilder = await this.collectionItemRepository
      .createQueryBuilder()
      .delete();

    updateItems.forEach((updateItem) => {
      if (updateItem.action === 'ADD') {
        const item = this.collectionItemRepository.create({
          collection: { id: updateItem?.collection_id } as Collection,
          wata: { id: updateItem?.wata_id } as Wata,
          adder: updater,
          updater: updater,
        });

        addItems.push(item);
      } else if (updateItem.action === 'DELETE') {
        isDelete = true;
        deleteQueryBuilder.orWhere(
          `(wata.id = ${updateItem?.wata_id} and collection.id = ${updateItem?.collection_id} and adder.id = ${updater.id})`,
        );
      }
    });

    if (addItems.length !== 0) {
      await this.collectionItemRepository.save(addItems);

      await this.collectionItemRepository.count({});
    }

    if (isDelete) {
      await deleteQueryBuilder.execute();
    }

    return updateItems;
  }

  async removeAll(user: User) {
    await this.collectionItemRepository.delete({
      adder: user,
    });

    await this.collectionRepository.delete({
      adder: user,
    });
  }
}
